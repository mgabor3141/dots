/**
 * Self-hosted inference server at inference.mgabor.hu.
 *
 * The static provider and default model live in models.json; the credential lives in
 * auth.json, which is where /login puts it. This extension discovers additional models
 * dynamically and applies request policies that cannot be expressed declaratively.
 *
 * The API key is never configured here: Pi resolves it, preferring a stored credential in
 * auth.json over whatever models.json declares. The one place that has to care is startup model
 * discovery, which runs before Pi exposes a registry, so it mirrors that same order off the two
 * files and defers to Pi as soon as a session exists. See startupKey and session_start below.
 *
 * It also registers video support in ./mgabor-video/media.ts: Pi has one media
 * block (image) and the endpoint wants two (image_url, video_url). read returns
 * video the way it returns images, and the payload part type is corrected below,
 * which is the only place the wire shape is reachable. Video behaviour itself has
 * no flags: the settings are constants in that module.
 *
 * Finally it stamps a scheduling `priority` on every request. The endpoint reads a
 * lower number as more urgent, so parents should outrank the subagents they spawn.
 * gmux already knows each session's root-relative lineage depth (its PR#542 wire
 * field), so the base priority is raised by one per depth: a root asks for
 * PRIORITY_BASE, its children PRIORITY_BASE+1, and so on. See resolveSubagentDepth.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promoteVideoParts, registerVideoRead } from "./mgabor-video/media.ts";
import { applyVideoSamplingHints, registerVideoSample } from "./mgabor-video/sample.ts";

const BASE_URL = "https://inference.mgabor.hu/v1";
const API = "openai-completions" as const;
const DEFAULT_CONTEXT_WINDOW = 262_144;

// Scheduling priority sent in the request body. The endpoint treats a lower number
// as more urgent, so a root gets the smallest value and each subagent generation
// adds one, keeping parents ahead of the children they launched. gmux owns lineage
// depth; when it cannot be read the safe default is a root at PRIORITY_BASE.
const PRIORITY_BASE = 5;
const execFileAsync = promisify(execFile);
// `gmux ls --json` is a local daemon round-trip; a short bound so an unavailable
// or wedged gmuxd degrades to the root default instead of delaying every turn.
const GMUX_LS_TIMEOUT_MS = 3_000;

type DiscoveredModel = { id: string; contextWindow: number };

/**
 * Key for the startup model-discovery call, which has to happen while Pi is still awaiting the
 * extension factory: there is no extension context yet, so no ModelRegistry, and Pi will not await
 * anything scheduled after the factory returns. Pi's own order is mirrored rather than reinvented,
 * and no environment variable is named here. A stored credential in auth.json wins; otherwise
 * models.json decides where the key comes from, so only its env-interpolated form is resolved. A
 * literal, a leading-!command, or anything unreadable yields undefined and gets asked of Pi at
 * session_start, which is the pass that actually has authority.
 */
function startupKey(): string | undefined {
  return storedCredential() ?? declaredEnvKey();
}

function readJson(url: URL): unknown {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return undefined;
  }
}

/** The `api_key` credential Pi stores for this provider, e.g. via /login. */
function storedCredential(): string | undefined {
  const auth = readJson(new URL("../auth.json", import.meta.url)) as
    | Record<string, { type?: unknown; key?: unknown }>
    | undefined;
  const entry = auth?.["mgabor"];
  return entry?.type === "api_key" && typeof entry.key === "string"
    ? entry.key
    : undefined;
}

/** models.json apiKey when it is written as "$VAR" or "${VAR}". */
function declaredEnvKey(): string | undefined {
  const models = readJson(new URL("../models.json", import.meta.url)) as
    | { providers?: Record<string, { apiKey?: unknown }> }
    | undefined;
  const declared = models?.providers?.["mgabor"]?.apiKey;
  if (typeof declared !== "string") return undefined;
  const envName = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(declared)?.[1];
  return envName ? process.env[envName] || undefined : undefined;
}

async function discoverModels(key: string): Promise<DiscoveredModel[]> {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`model discovery failed: HTTP ${response.status}`);

  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown; max_model_len?: unknown }>;
  };
  return (payload.data ?? []).flatMap((model) =>
    typeof model.id === "string" &&
    typeof model.max_model_len === "number" &&
    Number.isSafeInteger(model.max_model_len) &&
    model.max_model_len > 0
      ? [{ id: model.id, contextWindow: model.max_model_len }]
      : [],
  );
}

function providerModel({ id, contextWindow }: DiscoveredModel) {
  return {
    id,
    name: id,
    api: API,
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // maxTokens is descriptive metadata only; normal agent turns omit the
    // wire limit and let vLLM use all context remaining after the prompt.
    contextWindow,
    maxTokens: contextWindow,
    compat: {
      thinkingFormat: "openai" as const,
      supportsReasoningEffort: true,
    },
  };
}

export default async function (pi: ExtensionAPI) {
  // Overrides the built-in read tool so a video path returns a media block instead of text, and
  // adds video_sample for cutting a window out of a clip (the endpoint samples a fixed 32 frames
  // per video, so a window is the only way to get finer timing).
  registerVideoRead(pi);
  registerVideoSample(pi);

  // Pi waits for async extension factories, so the live catalogue is discovered at startup to keep
  // discovered model ids resolvable from the command line, then discovered again through Pi's own
  // resolver as soon as a session exists. That second pass is the one with authority: it sees
  // whatever Pi would authenticate with, including a credential stored after this process started.
  // A failed discovery never replaces a catalogue that already loaded.
  let contextWindowById = new Map<string, number>([
    ["default", DEFAULT_CONTEXT_WINDOW],
  ]);
  let discoveredWith: string | undefined;

  // Requests ask for PRIORITY_BASE + lineage depth. Resolved once a session exists
  // (see session_start); until then, and if gmux is absent, this stays a root.
  let priority = PRIORITY_BASE;

  // Stated in full, not just the model list, because pi takes api and baseUrl from whichever layer
  // describes the provider: models.json supplies them when it has a mgabor block, and a host without
  // one gets them from here or the registration is rejected outright. No apiKey on purpose, so the
  // credential stays pi's to resolve, from auth.json, with /login mgabor as the way to store one.
  function register(models: DiscoveredModel[]): void {
    pi.registerProvider("mgabor", {
      api: API,
      baseUrl: BASE_URL,
      models: models.map(providerModel),
    });
  }

  // The declarative floor, so the provider is usable before and without discovery.
  register([{ id: "default", contextWindow: DEFAULT_CONTEXT_WINDOW }]);

  async function discover(key: string | undefined): Promise<void> {
    if (!key || key === discoveredWith) return;
    try {
      const found = await discoverModels(key);
      if (found.length === 0) return;
      contextWindowById = new Map([
        ["default", DEFAULT_CONTEXT_WINDOW],
        ...found.map((model) => [model.id, model.contextWindow] as const),
      ]);
      register(found);
      discoveredWith = key;
    } catch {
      // Keep the declarative default when discovery is unavailable.
    }
  }

  await discover(startupKey());

  pi.on("session_start", async (_event, ctx) => {
    // Lineage depth is a daemon fact and cheap to read, so resolve it alongside the
    // (network-bound) model discovery instead of serialising a second stall.
    const [key] = await Promise.all([
      ctx.modelRegistry.getApiKeyForProvider("mgabor"),
      resolveSubagentDepth().then((depth) => {
        priority = PRIORITY_BASE + depth;
      }),
    ]);
    await discover(key);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload.model !== "string") return undefined;
    if (ctx.model?.provider !== "mgabor" || ctx.model.id !== payload.model) return undefined;

    // Stamp scheduling priority first: it must ride on every mgabor request, and
    // adding it guarantees the payload is treated as changed even when the Qwen and
    // skill rewrites below are no-ops.
    let nextPayload = applySubagentPriority(payload, priority);
    nextPayload = applyQwenRequestPolicy(nextPayload);
    nextPayload = rewriteSkillsInPayload(nextPayload);

    // Retype video parts before anything measures or sends the payload. Left as image_url the
    // bytes make the /tokenize call below answer "Failed to load image", and a failed
    // measurement silently skips the clamp; as video_url they are measured like any other part.
    const promoted = promoteVideoParts(nextPayload, ctx.model);
    if (promoted) nextPayload = promoted;

    // Same reason as above, and before the clamp: the frame count a video_sample call asked for
    // changes how many tokens the video is worth, so the measurement has to see it.
    const sampled = applyVideoSamplingHints(nextPayload, ctx.model);
    if (sampled) nextPayload = sampled;

    const contextWindow = contextWindowById.get(payload.model);
    if (contextWindow !== undefined) {
      const key = await ctx.modelRegistry.getApiKeyForProvider("mgabor");
      if (key) {
        nextPayload = await clampOutputToContext(nextPayload, key, contextWindow);
      }
    }

    return nextPayload === payload ? undefined : nextPayload;
  });

  // Give every history branch of one Pi session a stable diagnostic identity.
  // The proxy hashes this value for passive log correlation only; vLLM remains
  // solely responsible for matching and managing cached token-block prefixes.
  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== "mgabor") return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) event.headers["X-Session-Key"] = sessionId;
  });
}

// This session's root-relative lineage depth (0 for a root) as gmux sees it.
// gmux#542 exposes a per-session `depth` on the projection, which `gmux ls --json`
// carries; it is computed by the daemon over the durable parent graph, so it is the
// authoritative number the subagent budget enforces, not a cached copy that could
// drift the way an env var frozen at exec would. We only need our own live row, so
// the alive-only list is enough (our session is by definition alive) and far cheaper
// than `--all`. Absent GMUX_SESSION_ID (not under gmux), a missing row, a peer row
// that omits `depth`, or any gmux failure all fall back to 0 — the root default.
async function resolveSubagentDepth(): Promise<number> {
  const self = process.env.GMUX_SESSION_ID;
  if (!self) return 0;
  try {
    const { stdout } = await execFileAsync("gmux", ["ls", "--json"], {
      timeout: GMUX_LS_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const sessions: unknown = JSON.parse(stdout);
    if (!Array.isArray(sessions)) return 0;
    const me = sessions.find(
      (s): s is { id?: unknown; depth?: unknown } =>
        isRecord(s) && s.id === self,
    );
    const depth = me?.depth;
    return typeof depth === "number" &&
      Number.isSafeInteger(depth) &&
      depth >= 0
      ? depth
      : 0;
  } catch {
    return 0;
  }
}

function applySubagentPriority(
  payload: Record<string, unknown>,
  priority: number,
): Record<string, unknown> {
  return payload.priority === priority
    ? payload
    : { ...payload, priority };
}

function applyQwenRequestPolicy(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const templateArgs = isRecord(payload.chat_template_kwargs)
    ? payload.chat_template_kwargs
    : {};
  let nextPayload = payload;

  // Pi represents thinking-off by omitting reasoning_effort, but on the wire
  // omission means "no preference", which the service fills with its own
  // default. Only the client knows the difference, so say it explicitly.
  // none is standard OpenAI vocabulary, so this states intent rather than
  // encoding anything about the model behind the endpoint. Preserve explicit
  // chat-template overrides.
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

async function clampOutputToContext(
  payload: Record<string, unknown>,
  apiKey: string,
  contextWindow: number,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(payload.messages)) return payload;

  // vLLM interprets an omitted limit as all context remaining after the
  // prompt. Preserve that behavior for normal agent turns. Explicit limits,
  // such as Pi's smaller compaction-summary budget, are still made safe below.
  const usesMaxTokens = typeof payload.max_tokens === "number";
  const usesMaxCompletionTokens =
    typeof payload.max_completion_tokens === "number";
  if (!usesMaxTokens && !usesMaxCompletionTokens) return payload;
  const requested = usesMaxCompletionTokens
    ? (payload.max_completion_tokens as number)
    : (payload.max_tokens as number);

  const tokenizePayload: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
    add_generation_prompt: true,
  };
  for (const key of ["tools", "chat_template", "chat_template_kwargs"] as const) {
    if (key in payload) tokenizePayload[key] = payload[key];
  }

  try {
    const response = await fetch(`${BASE_URL}/tokenize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tokenizePayload),
    });
    if (!response.ok) return payload;
    const result = (await response.json()) as { count?: unknown };
    if (typeof result.count !== "number") return payload;

    const available = Math.max(1, contextWindow - result.count);
    const clamped = Math.min(requested, available);

    if (usesMaxTokens) {
      return payload.max_tokens === clamped
        ? payload
        : { ...payload, max_tokens: clamped };
    }
    return payload.max_completion_tokens === clamped
      ? payload
      : { ...payload, max_completion_tokens: clamped };
  } catch {
    // If tokenization is unavailable, retain Pi's normal request unchanged.
    return payload;
  }
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
