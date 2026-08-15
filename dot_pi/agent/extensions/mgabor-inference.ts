/**
 * Self-hosted inference server at inference.mgabor.hu.
 *
 * OpenAI-compatible endpoint with bearer-token auth. Models are discovered
 * dynamically from /v1/models at startup so whatever is loaded on the server
 * shows up in pi without having to edit this file.
 *
 * The API key is read from the MGABOR_INFERENCE_API_KEY env var (set in ~/.env).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://inference.mgabor.hu/v1";
const API_KEY_ENV = "MGABOR_INFERENCE_API_KEY";

function loadDotEnvIfNeeded(name: string): string | undefined {
  if (process.env[name]) return process.env[name];

  const envPath = join(process.env.HOME ?? "", ".env");
  if (!existsSync(envPath)) return undefined;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || match[1] !== name) continue;

    const value = match[2].replace(/^['"]|['"]$/g, "");
    process.env[name] = value;
    return value;
  }

  return undefined;
}

export default async function (pi: ExtensionAPI) {
  const key = loadDotEnvIfNeeded(API_KEY_ENV);
  if (!key) {
    // No key, nothing to register. Avoids a noisy 401 at startup.
    return;
  }

  let modelIds: string[] = [];
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      modelIds = payload.data?.map((m) => m.id) ?? [];
    }
  } catch {
    // Server unreachable at startup. Skip registration so pi doesn't crash.
    return;
  }

  if (modelIds.length === 0) return;
  const mgaborModelIds = new Set(modelIds);

  pi.registerProvider("mgabor", {
    name: "mgabor inference",
    baseUrl: BASE_URL,
    // Pass the resolved secret directly. We already loaded it from
    // process.env/~/.env above; passing the bare env-var *name* is treated
    // as a legacy reference and triggers a deprecation warning.
    apiKey: key,
    api: "openai-completions",
    // The aliases and literal model ID all route to the same Qwen3.8 backend.
    models: modelIds.map((id) => ({
      id,
      name: id,
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 131072,
      compat: {
        thinkingFormat: "openai",
        supportsReasoningEffort: true,
        reasoningEffortMap: {
          minimal: "low",
          medium: "xhigh",
          high: "xhigh",
        },
      },
    })),
  });

  // This event lacks a provider ID, so scope it to the model IDs registered
  // above. A same-named model from another provider could still collide.
  pi.on("before_provider_request", (event) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload.model !== "string") return undefined;
    if (!mgaborModelIds.has(payload.model)) return undefined;

    let nextPayload = applyQwenRequestPolicy(payload);
    nextPayload = rewriteSkillsInPayload(nextPayload);
    return nextPayload === payload ? undefined : nextPayload;
  });
}

function applyQwenRequestPolicy(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const templateArgs = isRecord(payload.chat_template_kwargs)
    ? payload.chat_template_kwargs
    : {};
  let nextPayload = payload;

  // Pi represents thinking-off by omitting reasoning_effort, while Qwen3.8
  // treats omission as xhigh. Preserve explicit chat-template overrides.
  if (
    typeof payload.reasoning_effort !== "string" &&
    !("enable_thinking" in templateArgs)
  ) {
    nextPayload = { ...nextPayload, reasoning_effort: "none" };
  }

  // Keep reasoning available across agent turns unless the caller opts out.
  if (!("preserve_thinking" in templateArgs)) {
    nextPayload = {
      ...nextPayload,
      chat_template_kwargs: { ...templateArgs, preserve_thinking: true },
    };
  }

  return nextPayload;
}

function rewriteSkillsInPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) return payload;

  const sys = messages[0] as { role?: string; content?: unknown };
  if (sys.role !== "developer" && sys.role !== "system") return payload;

  let text: string | undefined;
  let isArrayContent = false;
  if (typeof sys.content === "string") {
    text = sys.content;
  } else if (Array.isArray(sys.content)) {
    text = sys.content
      .map((part: { text?: string }) =>
        part && typeof part.text === "string" ? part.text : "",
      )
      .join("");
    isArrayContent = true;
  }
  if (text === undefined) return payload;

  const rewritten = rewriteAvailableSkills(text);
  if (rewritten === text) return payload;

  const newSys = {
    ...sys,
    content: isArrayContent ? [{ type: "text", text: rewritten }] : rewritten,
  };
  return { ...payload, messages: [newSys, ...messages.slice(1)] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Qwen3.6 sometimes mistook Pi's skills XML for tool-call syntax. Replace
// that block with equivalent markdown pending a Qwen3.8 removal A/B test.
// If the block is absent or malformed, leave the prompt unchanged.
function rewriteAvailableSkills(text: string): string {
  const blockRe = /<available_skills>([\s\S]*?)<\/available_skills>/;
  const block = blockRe.exec(text);
  if (!block) return text;

  const skillRe =
    /<skill>\s*<name>([^<]+)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([^<]+)<\/location>\s*<\/skill>/g;
  const skills: Array<{ name: string; description: string; location: string }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = skillRe.exec(block[1])) !== null) {
    skills.push({
      name: m[1].trim(),
      description: m[2].trim(),
      location: m[3].trim(),
    });
  }
  if (skills.length === 0) return text;

  const md =
    "Available skills (load via `read` when a task matches):\n" +
    skills
      .map(
        (s) =>
          `- **${s.name}**: ${s.description} (location: \`${s.location}\`)`,
      )
      .join("\n");
  return text.replace(blockRe, md);
}
