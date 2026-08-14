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
          low: "low",
          medium: "medium",
          high: "xhigh",
          xhigh: "xhigh",
        },
      },
    })),
  });

  // Rewrite the <available_skills> XML block in the developer/system
  // message to a markdown bullet list before the request hits vLLM.
  //
  // Why: Qwen3.6 has a learned CodeAct/Cline attractor that fires when
  // the system prompt contains XML-tag listings shaped like
  // <available_skills><skill><name>...</name>...</skill>...</available_skills>.
  // When the attractor wins, the model emits tool calls in the wrong
  // grammar (`<bash>{"command":...}</bash>` instead of the
  // `<tool_call><function=bash><parameter=command>...` format vLLM's
  // qwen3_xml parser expects). Empirical garble rate on coding-shaped
  // first-turn prompts: 48% before this rewrite, ~0% after.
  // (Stack: vllm-overlay parser-fix + this rewrite combined.)
  //
  // We scope the hook to this provider by checking payload.model
  // against the set of model ids we registered. Other providers in
  // the user's config (e.g. anthropic) see their payloads unchanged.
  pi.on("before_provider_request", (event) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload.model !== "string") return undefined;
    if (!mgaborModelIds.has(payload.model)) return undefined;

    let changed = false;
    let nextPayload = payload;
    const templateArgs = isRecord(payload.chat_template_kwargs)
      ? payload.chat_template_kwargs
      : {};

    // Qwen3.8 defaults to xhigh thinking when no control is sent. Pi represents
    // thinking-off by omitting reasoning_effort, so make that state explicit.
    // Preserve an explicit low-level enable_thinking override for callers that
    // intentionally use the Qwen chat-template API directly.
    if (
      typeof payload.reasoning_effort !== "string" &&
      !("enable_thinking" in templateArgs)
    ) {
      nextPayload = { ...nextPayload, reasoning_effort: "none" };
      changed = true;
    }

    // Preserve reasoning across agent turns and tool calls, matching Qwen3.8's
    // recommended default. Explicit caller overrides still win.
    if (!("preserve_thinking" in templateArgs)) {
      nextPayload = {
        ...nextPayload,
        chat_template_kwargs: { ...templateArgs, preserve_thinking: true },
      };
      changed = true;
    }

    const messages = payload.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const sys = messages[0] as { role?: string; content?: unknown };
      if (sys.role === "developer" || sys.role === "system") {
        // Content may be a string or OpenAI v2 message-parts array.
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

        if (text !== undefined) {
          const rewritten = rewriteAvailableSkills(text);
          if (rewritten !== text) {
            const newSys = {
              ...sys,
              content: isArrayContent ? [{ type: "text", text: rewritten }] : rewritten,
            };
            nextPayload = { ...nextPayload, messages: [newSys, ...messages.slice(1)] };
            changed = true;
          }
        }
      }
    }

    return changed ? nextPayload : undefined;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Replace the <available_skills>...<skill>...</skill>...</available_skills>
// block with an equivalent markdown bullet list. Preserves name,
// description, and location for each skill. If the block is absent or
// no <skill> entries are found, returns the input unchanged.
function rewriteAvailableSkills(text: string): string {
  const blockRe = /<available_skills>([\s\S]*?)<\/available_skills>/;
  const block = blockRe.exec(text);
  if (!block) return text;

  const skillRe =
    /<skill>\s*<name>([^<]+)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([^<]+)<\/location>\s*<\/skill>/g;
  const skills: Array<{ name: string; description: string; location: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = skillRe.exec(block[1])) !== null) {
    skills.push({ name: m[1].trim(), description: m[2].trim(), location: m[3].trim() });
  }
  if (skills.length === 0) return text;

  const md =
    "Available skills (load via `read` when a task matches):\n" +
    skills.map((s) => `- **${s.name}**: ${s.description} (location: \`${s.location}\`)`).join("\n");
  return text.replace(blockRe, md);
}
