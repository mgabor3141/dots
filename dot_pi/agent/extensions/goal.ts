/**
 * goal.ts: an autonomous "keep working until done" goal loop.
 *
 * A simplified, single-file reimagining of pi-goal (github.com/PurpleMyst/pi-goal),
 * tailored to my preferences. Set a goal with `/goal <objective>`; after each agent
 * cycle the extension re-injects a continuation prompt so the agent keeps working
 * toward the objective. It stops when the agent winds down on its own:
 *
 *   - A cycle that uses NO tools is read as "I think I'm done."
 *   - We don't trust that immediately: we send a verification prompt (the "grace
 *     round") that pushes the agent to test/verify against real evidence.
 *   - If the agent then acts again (tools), we drop back into the normal loop.
 *   - If the agent again does nothing, the goal is considered complete.
 *
 * There is intentionally NO completion tool for the model to call. Relying on the
 * agent ceasing activity (after a forced verification pass) avoids the "declare
 * victory in one confident tool call" failure mode.
 *
 * State is in-memory and single-session. After a full restart, re-issue
 * `/goal <objective>` to re-arm; the conversation history pi reloads already carries
 * the actual work, so the loop picks up where it left off.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "goal";

type Mode = "continue" | "verify";
type ThemeLike = { fg: (color: string, text: string) => string };
type AnyCtx = ExtensionContext | ExtensionCommandContext;

interface Goal {
  objective: string;
  active: boolean;
  awaitingVerification: boolean;
  startedAt: number;
}

// --- module state (in-memory, single session) ----------------------------------

let goal: Goal | null = null;
let toolsUsedThisCycle = false;

// --- prompts (tune these freely) ------------------------------------------------

function objectiveBlock(objective: string): string {
  return objective
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Sent after any cycle that used tools; keep grinding. */
function continuationPrompt(objective: string): string {
  return [
    "Keep working toward your goal:",
    "",
    objectiveBlock(objective),
    "",
    "Continue from where you are. Don't redo work that's already done.",
  ].join("\n");
}

/** Sent after the first no-tool cycle; the grace round that proves it's actually done. */
function verificationPrompt(objective: string): string {
  return [
    "Before calling this done, double-check your work against the real state of things.",
    "",
    objectiveBlock(objective),
    "",
    "Verify your assumptions are actually correct: read the files, run the tests, look at the actual output. Don't trust memory, intent, or effort spent; passing checks only count if they genuinely cover the goal.",
    "",
    "If anything is missing, wrong, or unverified, keep working. Otherwise, summarize what you did.",
  ].join("\n");
}

// --- helpers --------------------------------------------------------------------

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function widgetLine(theme: ThemeLike): string {
  const g = goal!;
  const state = !g.active ? "paused" : g.awaitingVerification ? "verifying" : "active";
  const obj = g.objective.length > 50 ? `${g.objective.slice(0, 49)}…` : g.objective;
  return `${theme.fg("accent", "🎯 goal")} ${theme.fg("dim", `(${state}, ${fmtElapsed(Date.now() - g.startedAt)})`)} ${obj}`;
}

function updateWidget(ctx: AnyCtx): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, goal ? [widgetLine(ctx.ui.theme as ThemeLike)] : undefined);
}

function note(ctx: AnyCtx, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

/**
 * Start (or re-arm) one loop iteration: reset the per-cycle flag and send the prompt
 * as a real user message. We use sendUserMessage (not a custom sendMessage) so the
 * continuation goes through the full prompt pipeline and fires `before_agent_start`
 * each turn; otherwise per-turn hooks (e.g. the system-prompt extension) would be
 * skipped on continuation turns.
 */
function sendContinuation(pi: ExtensionAPI, mode: Mode): void {
  if (!goal) return;
  toolsUsedThisCycle = false;
  const prompt =
    mode === "verify" ? verificationPrompt(goal.objective) : continuationPrompt(goal.objective);
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

function showStatus(ctx: AnyCtx): void {
  if (!goal) {
    note(ctx, "No active goal. Set one with /goal <objective>.");
    return;
  }
  const state = !goal.active ? "paused" : goal.awaitingVerification ? "verifying" : "active";
  note(
    ctx,
    `Goal (${state}, ${fmtElapsed(Date.now() - goal.startedAt)}): ${goal.objective}`,
  );
}

// --- extension ------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Autonomous goal loop. Usage: /goal <objective> | pause | resume | clear",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const arg = args.trim();
      const lc = arg.toLowerCase();

      if (lc === "") {
        showStatus(ctx);
        return;
      }

      if (lc === "pause") {
        if (goal?.active) {
          goal.active = false;
          note(ctx, "Goal paused.");
        } else {
          note(ctx, "No active goal to pause.", "warning");
        }
        updateWidget(ctx);
        return;
      }

      if (lc === "resume") {
        if (goal && !goal.active) {
          goal.active = true;
          goal.awaitingVerification = false;
          note(ctx, "Goal resumed.");
          sendContinuation(pi, "continue");
        } else if (goal?.active) {
          note(ctx, "Goal is already running.", "warning");
        } else {
          note(ctx, "No goal to resume.", "warning");
        }
        updateWidget(ctx);
        return;
      }

      if (lc === "clear") {
        goal = null;
        note(ctx, "Goal cleared.");
        updateWidget(ctx);
        return;
      }

      // Anything else is a (possibly replacement) objective.
      const replacing = goal !== null;
      goal = { objective: arg, active: true, awaitingVerification: false, startedAt: Date.now() };
      note(ctx, replacing ? "Replaced active goal." : "Goal set.");
      sendContinuation(pi, "continue");
      updateWidget(ctx);
    },
  });

  // Track whether the current cycle took any concrete action.
  pi.on("tool_call", async () => {
    toolsUsedThisCycle = true;
  });

  // Make the loop interruptible: abort sets it down so agent_end won't re-fire.
  // (ctx.signal.aborted is only set in turn-related events, not agent_end.)
  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.signal?.aborted && goal?.active) {
      goal.active = false;
      note(ctx, "Goal loop interrupted; paused.", "warning");
      updateWidget(ctx);
    }
  });

  // The loop itself.
  pi.on("agent_end", async (_event, ctx) => {
    if (!goal?.active) return;

    if (toolsUsedThisCycle) {
      // Real work happened, so keep going (and cancel any pending "done" verdict).
      goal.awaitingVerification = false;
      sendContinuation(pi, "continue");
    } else if (!goal.awaitingVerification) {
      // First no-tool cycle: don't trust it, so force a verification pass.
      goal.awaitingVerification = true;
      sendContinuation(pi, "verify");
    } else {
      // Second consecutive no-tool cycle (even after being told to verify): done.
      goal.active = false;
      note(ctx, "Goal complete. No further action after verification.");
    }
    updateWidget(ctx);
  });
}
