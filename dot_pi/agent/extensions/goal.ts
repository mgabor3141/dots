/**
 * goal.ts: a goal-directed "diligent user" loop.
 *
 * You drive the agent normally. When you want it pushed toward a finished
 * result, run `/goal <what you want>` (the goal is optional). After the agent
 * next goes idle, a separate one-shot LLM call (the "proxy") stands in for you,
 * the user, and writes the next message a careful, slightly demanding user
 * would send. That message is injected as the agent's next turn. This repeats
 * until the proxy decides the goal is met (it replies STOP), needs a decision
 * from you (it replies HALT), or you run `goal-clear` (or press Esc).
 *
 * The goal is the proxy's north star. It supplies a terminus (when to stop),
 * scope (which actions are in bounds), and direction (what to push toward).
 * Crucially, the proxy must NOT steer the agent toward irreversible or external
 * actions (merging, pushing, publishing, deleting, sending) unless the goal
 * explicitly calls for them, and "prepare X" never means "do X". When a
 * consequential decision arises that the goal does not settle, the proxy hands
 * it back to you (HALT) instead of deciding. Without a goal, nothing
 * consequential is authorized, so the loop just pushes for thoroughness.
 *
 * The proxy is NOT a verifier. It takes the agent at its word and does not see
 * tool calls, tool results, or the agent's internal reasoning, only the
 * conversation. We send it the conversation with roles SWAPPED: the agent's
 * turns become `user` turns and the user side (your messages plus the proxy's
 * own earlier nudges) becomes `assistant` turns, so the proxy is literally in
 * the user's seat and its natural next `assistant` turn is the next message.
 *
 * Commands: `/goal [text]` starts or updates the loop; `goal-clear` stops it
 * (the current turn finishes; no further prompts are injected).
 *
 * Proxy model: the first available token in PI_LIBRARIAN_MODELS
 * ("provider/model:thinking"), falling back to the current model.
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

const WIDGET_KEY = "goal";
const MAX_PASSES = 10;
const THINKING_LEVELS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const PROXY_GREETING = "I'm ready to help. What would you like me to work on?";
// Tags injected turns so they are distinguishable from real user messages. The
// proxy sees its own prior (prefixed) turns and may echo the prefix, so we
// strip it on the way in and add exactly one on the way out (idempotent).
const MESSAGE_PREFIX = "[goal] ";

type ThemeLike = { fg: (color: string, text: string) => string };
type AnyCtx = ExtensionContext | ExtensionCommandContext;
type ProxyModel = { model: NonNullable<ExtensionContext["model"]>; thinking?: ThinkingLevel };
type Reply = { kind: "continue" | "stop" | "halt"; text: string };
type SwapTurn = { role: "user" | "assistant"; text: string };

// Loose views of the message shapes we read out of the session branch.
type Block = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown };

// --- module state (in-memory, single session) ----------------------------------

let active = false;
let goal: string | null = null;
let passes = 0;
let startedAt = 0;
let running = false; // a proxy call is in flight; guards against reentrancy

// --- prompt ---------------------------------------------------------------------

function buildProxySystem(currentGoal: string | null): string {
  const lines = [
    "You play the human user in a conversation with a capable coding agent. Mechanically, your own turns appear in the assistant role and the agent's turns appear in the user role; always answer as the human user writing the next message to the agent.",
    "",
  ];
  if (currentGoal) {
    lines.push(
      "Your goal for this work, in your own words, is:",
      currentGoal,
      "",
      "Steer the agent toward exactly this goal and judge completion against it. Do only what the goal calls for. If the goal asks to prepare or get something ready, that does not authorize doing the final step. For example, a goal of \"a PR that is ready to merge\" means stop once it is ready and do NOT merge it.",
      "",
    );
  } else {
    lines.push(
      "The user has not stated a specific goal. Push the agent to finish the work it has already taken on and to make it thorough and correct, and judge completion by whether that work is genuinely done.",
      "",
    );
  }
  lines.push(
    "Take the agent at its word: you do not verify its claims and you do not need to see its tools or output. Your value is making sure nothing is forgotten. Nudge it to test what it built, to handle edge cases and error paths, to check assumptions against real sources, to look at any visible output, and to simplify or document where that helps. A short, natural nudge is enough; the agent can work out the specifics. Keep each message brief and in a plain user voice. Do not invent requirements beyond the goal or the work already underway.",
    "",
    "Never steer the agent toward actions with external, lasting, or hard-to-reverse consequences unless your goal explicitly calls for them. That includes merging, pushing to shared or protected branches, force-pushing, publishing or releasing, deploying, deleting data or branches, sending messages, opening or closing things that notify other people, and spending money. When in doubt, treat an action as consequential.",
    "",
    "End the loop with one of these instead of a normal message:",
    "- Reply with exactly STOP on its own line when the goal is met (or the work is genuinely done) and there is nothing left to do safely.",
    "- Reply with HALT: followed by a one-line question when reaching the goal would require a consequential action you are not authorized to take, or when a decision with lasting consequences comes up that the goal does not settle. Hand that decision back to the user rather than making it yourself.",
  );
  return lines.join("\n");
}

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
  const label = goal ? (goal.length > 48 ? `${goal.slice(0, 47)}…` : goal) : "(general)";
  const line = `${theme.fg("accent", "🎯 goal")} ${theme.fg("dim", `(${state}, ${fmtElapsed(Date.now() - startedAt)})`)} ${label}`;
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
  const halt = firstLine.match(/^halt\b[:.\-\s]*(.*)$/i);
  if (halt) {
    const rest = trimmed.slice(trimmed.indexOf(firstLine) + firstLine.length).trim();
    const question = [halt[1].trim(), rest].filter(Boolean).join("\n").trim();
    return { kind: "halt", text: question || "A decision is needed before continuing." };
  }
  if (/^stop\b/i.test(firstLine)) return { kind: "stop", text: trimmed };
  return { kind: "continue", text: trimmed };
}

/** Run one proxy pass. Returns the reply, or null if the call could not run. */
async function runProxy(ctx: AnyCtx): Promise<Reply | null> {
  const picked = pickProxyModel(ctx);
  if (!picked) {
    note(ctx, "No model available for the goal loop.", "error");
    return null;
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(picked.model);
  if (!auth.ok || !auth.apiKey) {
    note(ctx, auth.ok ? `No API key for ${picked.model.provider}/${picked.model.id}.` : auth.error, "error");
    return null;
  }

  const res = await complete(
    picked.model,
    { systemPrompt: buildProxySystem(goal), messages: buildSwappedMessages(ctx) },
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
  // The proxy may have echoed the prefix from its prior turns; drop it before
  // parsing so STOP/HALT detection works and we do not double-prefix on inject.
  const cleaned = text.startsWith(MESSAGE_PREFIX) ? text.slice(MESSAGE_PREFIX.length).trimStart() : text;
  return parseReply(cleaned);
}

/** One iteration: ask the proxy, then either stop, halt, or inject its message. */
async function tick(pi: ExtensionAPI, ctx: AnyCtx): Promise<void> {
  if (!active || running) return;
  if (passes >= MAX_PASSES) {
    active = false;
    note(ctx, `Goal loop stopped after ${MAX_PASSES} passes.`, "warning");
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
    note(ctx, `Goal loop failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    updateWidget(ctx);
    return;
  }
  running = false;

  if (!active) return; // cleared or Esc while the proxy was running
  if (!reply) {
    active = false; // error already surfaced
    updateWidget(ctx);
    return;
  }

  if (reply.kind === "stop") {
    active = false;
    note(ctx, goal ? "Goal reached: the work looks done." : "The work looks done.");
    updateWidget(ctx);
    return;
  }

  if (reply.kind === "halt") {
    active = false;
    note(ctx, `Paused for your decision: ${reply.text}`, "warning");
    updateWidget(ctx);
    return;
  }

  passes += 1;
  updateWidget(ctx);
  const body = reply.text || "Are you sure this is complete? Double-check anything you might have missed.";
  const message = body.startsWith(MESSAGE_PREFIX) ? body : `${MESSAGE_PREFIX}${body}`;
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

// --- extension ------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Start or update the goal loop: a stand-in user pushes the agent toward your goal (optional) until done. Run goal-clear to stop.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!hasWork(ctx)) {
        note(ctx, "Nothing to work on yet. Let the agent do something first.", "warning");
        return;
      }
      goal = args.trim() || null;
      active = true;
      passes = 0;
      startedAt = Date.now();
      note(ctx, goal ? `Goal set: ${goal}` : "Goal loop started (no specific goal). Run goal-clear to stop.");
      updateWidget(ctx);
      if (ctx.isIdle()) await tick(pi, ctx);
    },
  });

  pi.registerCommand("goal-clear", {
    description: "Stop the goal loop. The current turn finishes; no further prompts are injected.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!active) {
        note(ctx, "No goal loop is active.");
        return;
      }
      active = false;
      goal = null;
      note(ctx, "Goal loop cleared. The current turn will finish without re-prompting.");
      updateWidget(ctx);
    },
  });

  // Reload/new/fork/quit tears down this instance. Stop the loop so a lingering
  // old closure cannot keep injecting after a fresh instance is bound.
  pi.on("session_shutdown", async (_event, ctx) => {
    active = false;
    goal = null;
    running = false;
    updateWidget(ctx);
  });

  // Make the loop interruptible: an aborted turn (Esc) stops it.
  // (ctx.signal.aborted is only set in turn-related events, not agent_end.)
  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.signal?.aborted && active) {
      active = false;
      note(ctx, "Goal loop stopped.", "warning");
      updateWidget(ctx);
    }
  });

  // The loop: each time the agent goes idle, run a proxy pass.
  pi.on("agent_end", async (_event, ctx) => {
    if (!active || running) return;
    await tick(pi, ctx);
  });
}
