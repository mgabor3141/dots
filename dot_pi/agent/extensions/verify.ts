/**
 * verify.ts: an on-demand "diligent user" loop.
 *
 * You drive the agent normally. When you want it pushed toward a thorough,
 * finished result, run `/verify` (run it again to turn it off). After the agent
 * next goes idle, a separate one-shot LLM call (the "proxy") stands in for you,
 * the user, and writes the next message a careful, slightly demanding user
 * would send: did you test it, did you handle the edge cases, are you sure it
 * is complete. That message is injected as the agent's next turn. This repeats
 * until the proxy decides the work is genuinely done (it replies STOP), or you
 * press Esc.
 *
 * The proxy is NOT a verifier. It takes the agent at its word and does not see
 * tool calls, tool results, or the agent's internal reasoning. It only sees the
 * conversation: your messages and the agent's turn-ending replies. Its value is
 * making sure nothing is forgotten, not catching the agent in a lie; the agent
 * is capable enough to work out the specifics from a nudge.
 *
 * Mechanically we send the proxy the conversation with roles SWAPPED: the
 * agent's turns become `user` turns and the user side (your messages plus the
 * proxy's own earlier nudges) becomes `assistant` turns. So the proxy is
 * literally sitting in the user's seat, and its natural next `assistant` turn
 * is the next user message. A synthetic leading `user` turn keeps the message
 * list starting with `user` for providers that require it.
 *
 * Proxy model: the first available token in PI_LIBRARIAN_MODELS
 * ("provider/model:thinking", comma-separated), falling back to the current
 * model. A prototyping choice (cheap model), independent of the main agent.
 *
 * State is in-memory and single-session. Nothing is persisted.
 */

import { complete } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "verify";
const MAX_PASSES = 10;
const THINKING_LEVELS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const PROXY_GREETING = "I'm ready to help. What would you like me to work on?";

type ThemeLike = { fg: (color: string, text: string) => string };
type AnyCtx = ExtensionContext | ExtensionCommandContext;
type ProxyModel = { model: NonNullable<ExtensionContext["model"]>; thinking?: ThinkingLevel };
type Reply = { stop: boolean; text: string };
type SwapTurn = { role: "user" | "assistant"; text: string };

// Loose views of the message shapes we read out of the session branch.
type Block = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown };

// --- module state (in-memory, single session) ----------------------------------

let active = false;
let passes = 0;
let startedAt = 0;
let running = false; // a proxy call is in flight; guards against reentrancy

// --- prompt ---------------------------------------------------------------------

const PROXY_SYSTEM = [
  "You play the human user in a conversation with a capable coding agent. Mechanically, your own turns appear in the assistant role and the agent's turns appear in the user role; always answer as the human user writing the next message to the agent.",
  "",
  "You gave the agent a task and you are shepherding it to a thorough, complete result, the way a careful and slightly demanding user would. Take the agent at its word: you do not verify its claims and you do not need to see its tools or output. Your value is making sure nothing is forgotten. Nudge it to test what it built, to handle edge cases and error paths, to check assumptions against real sources, to look at any visible output, and to simplify or document where that helps.",
  "",
  "You do not need to know the exact right question; a short, natural nudge is enough, because the agent can work out the specifics. Keep each message brief and in a plain user voice. Do not invent requirements the original task never implied.",
  "",
  "When the agent has clearly finished the request and has said it cannot meaningfully improve the work further, reply with exactly STOP on its own line and nothing else.",
].join("\n");

// --- conversation assembly ------------------------------------------------------

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * Build the role-swapped message list for the proxy: agent turns become `user`,
 * user-side turns (your messages and the proxy's own prior nudges) become
 * `assistant`. Tool calls, tool results, and reasoning are dropped; only each
 * agent turn's ending prose is kept. A synthetic leading `user` turn keeps the
 * list starting with `user`, and consecutive same-role turns are merged.
 */
function buildSwappedMessages(ctx: AnyCtx) {
  const branch = ctx.sessionManager.getBranch() as Array<{ type: string; message?: Msg }>;
  const msgs = branch.filter((e) => e.type === "message" && e.message).map((e) => e.message as Msg);

  const swapped: SwapTurn[] = [];
  let pendingAgentText: string | null = null; // last non-empty assistant prose in the current run
  const flush = () => {
    if (pendingAgentText) {
      swapped.push({ role: "user", text: pendingAgentText });
      pendingAgentText = null;
    }
  };
  for (const m of msgs) {
    if (m.role === "user") {
      flush();
      const t = extractText(m.content).trim();
      if (t) swapped.push({ role: "assistant", text: t });
    } else if (m.role === "assistant") {
      const t = extractText(m.content).trim(); // text blocks only (skips thinking and toolCall)
      if (t) pendingAgentText = t;
    }
  }
  flush();

  const turns: SwapTurn[] = [{ role: "user", text: PROXY_GREETING }, ...swapped];
  const merged: SwapTurn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n\n${t.text}`;
    else merged.push({ ...t });
  }
  // Synthetic turns: the provider only serializes role + text content, so we
  // cast past the rich Message union (AssistantMessage's api/usage/etc.).
  const out = merged.map((t) => ({
    role: t.role,
    content: [{ type: "text" as const, text: t.text }],
    timestamp: Date.now(),
  }));
  return out as unknown as Parameters<typeof complete>[1]["messages"];
}

// --- helpers --------------------------------------------------------------------

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function updateWidget(ctx: AnyCtx): void {
  if (!ctx.hasUI) return;
  if (!active) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  const theme = ctx.ui.theme as ThemeLike;
  const state = running ? "thinking" : "active";
  const line = `${theme.fg("accent", "🔎 verify")} ${theme.fg("dim", `(${state}, ${fmtElapsed(Date.now() - startedAt)})`)}`;
  ctx.ui.setWidget(WIDGET_KEY, [line]);
}

function note(ctx: AnyCtx, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

/** True once the agent has actually produced something worth pushing on. */
function hasWork(ctx: AnyCtx): boolean {
  const branch = ctx.sessionManager.getBranch() as Array<{ type: string; message?: { role?: string } }>;
  return branch.some((e) => e.type === "message" && e.message?.role === "assistant");
}

/**
 * Pick the proxy model: first available PI_LIBRARIAN_MODELS token
 * ("provider/model:thinking"), else the current model.
 */
function pickProxyModel(ctx: AnyCtx): ProxyModel | null {
  const available = ctx.modelRegistry.getAvailable();
  const raw = process.env.PI_LIBRARIAN_MODELS;
  if (raw) {
    for (const token of raw.split(",")) {
      const t = token.trim();
      const slash = t.indexOf("/");
      if (slash <= 0) continue;
      const provider = t.slice(0, slash).trim().toLowerCase();
      const rest = t.slice(slash + 1);
      const colon = rest.lastIndexOf(":");
      const modelId = (colon > 0 ? rest.slice(0, colon) : rest).trim().toLowerCase();
      const thinkingRaw = colon > 0 ? rest.slice(colon + 1).trim().toLowerCase() : "";
      const match = available.find(
        (m) => m.provider.toLowerCase() === provider && m.id.toLowerCase() === modelId,
      );
      if (!match) continue;
      return { model: match, thinking: THINKING_LEVELS.has(thinkingRaw) ? (thinkingRaw as ThinkingLevel) : undefined };
    }
  }
  return ctx.model ? { model: ctx.model } : null;
}

function parseReply(text: string): Reply {
  const trimmed = text.trim();
  const firstLine = (trimmed.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  if (/^stop[.!]?$/i.test(firstLine)) return { stop: true, text: trimmed };
  return { stop: false, text: trimmed };
}

/** Run one proxy pass. Returns the reply, or null if the call could not run. */
async function runProxy(ctx: AnyCtx): Promise<Reply | null> {
  const picked = pickProxyModel(ctx);
  if (!picked) {
    note(ctx, "No model available for verification.", "error");
    return null;
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(picked.model);
  if (!auth.ok || !auth.apiKey) {
    note(ctx, auth.ok ? `No API key for ${picked.model.provider}/${picked.model.id}.` : auth.error, "error");
    return null;
  }

  const res = await complete(
    picked.model,
    { systemPrompt: PROXY_SYSTEM, messages: buildSwappedMessages(ctx) },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: ctx.signal ?? undefined,
      ...(picked.thinking ? { reasoning: picked.thinking } : {}),
    },
  );
  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return parseReply(text);
}

/** One iteration: ask the proxy, then either stop or inject its next message. */
async function tick(pi: ExtensionAPI, ctx: AnyCtx): Promise<void> {
  if (!active || running) return;
  if (passes >= MAX_PASSES) {
    active = false;
    note(ctx, `Verification stopped after ${MAX_PASSES} passes.`, "warning");
    updateWidget(ctx);
    return;
  }

  running = true;
  updateWidget(ctx);
  let reply: Reply | null;
  try {
    reply = await runProxy(ctx);
  } catch (err) {
    active = false;
    running = false;
    note(ctx, `Verification failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    updateWidget(ctx);
    return;
  }
  running = false;

  if (!active) return; // toggled off or Esc while the proxy was running
  if (!reply) {
    active = false; // error already surfaced
    updateWidget(ctx);
    return;
  }

  if (reply.stop) {
    active = false;
    note(ctx, "Verification complete: the work looks done.");
    updateWidget(ctx);
    return;
  }

  passes += 1;
  updateWidget(ctx);
  const message = reply.text || "Are you sure this is complete? Double-check anything you might have missed.";
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

// --- extension ------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("verify", {
    description: "Toggle the verification loop (a stand-in user pushes the agent until the work is done). Esc also stops it.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (active) {
        active = false;
        note(ctx, "Verification disabled.");
        updateWidget(ctx);
        return;
      }
      if (!hasWork(ctx)) {
        note(ctx, "Nothing to verify yet. Let the agent do some work first.", "warning");
        return;
      }
      active = true;
      passes = 0;
      startedAt = Date.now();
      note(ctx, "Verification enabled. Pushing the agent when it goes idle; /verify or Esc to stop.");
      updateWidget(ctx);
      if (ctx.isIdle()) await tick(pi, ctx);
    },
  });

  // Make the loop interruptible: an aborted turn stops it.
  // (ctx.signal.aborted is only set in turn-related events, not agent_end.)
  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.signal?.aborted && active) {
      active = false;
      note(ctx, "Verification stopped.", "warning");
      updateWidget(ctx);
    }
  });

  // The loop: each time the agent goes idle, run a proxy pass.
  pi.on("agent_end", async (_event, ctx) => {
    if (!active || running) return;
    await tick(pi, ctx);
  });
}
