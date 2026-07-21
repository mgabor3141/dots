/**
 * /continue — resume the agent from the current point WITHOUT adding a user turn.
 *
 * Use case: a turn was interrupted (network drop, killed stream, a dangling
 * tool-call result) and you want the model to pick up exactly where it left off,
 * as if the interruption never happened.
 *
 * How it works
 * ------------
 * Extensions cannot call the low-level `agent.continue()` that pi uses internally
 * to resume a loop with no new message. The only ways to kick the agent loop from
 * an extension are `pi.sendMessage()` / `pi.sendUserMessage()`, and every message
 * they inject is serialized to a `user`-role message before it reaches the model.
 *
 * To get a *true* continuation we:
 *   1. Inject a hidden custom message (`display: false`) purely to start the loop.
 *   2. Strip that message back out in the `context` event, which fires before every
 *      LLM call and lets us edit the outgoing message list non-destructively.
 *
 * The provider therefore sees the exact pre-interruption context (ending on the
 * tool result / aborted assistant message) and continues naturally. The trigger
 * message never reaches the model and never clutters the transcript.
 *
 * Caveat: if the last message is a *completed* assistant answer, some providers
 * reject a request that ends on an assistant turn. That is the same inherent
 * limitation as pi's own continue — for interrupted turns the trailing message is
 * a tool result or an aborted assistant, which resumes fine.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CONTINUE_TYPE = "continue-trigger";

export default function (pi: ExtensionAPI) {
	// Remove our invisible trigger message before it is sent to the provider,
	// so the model just continues from the real prior context.
	pi.on("context", async (event) => {
		const messages = event.messages.filter(
			(m) => !(m.role === "custom" && (m as { customType?: string }).customType === CONTINUE_TYPE),
		);
		if (messages.length === event.messages.length) return;
		return { messages };
	});

	pi.registerCommand("continue", {
		description: "Continue from the current point without adding a user message",
		handler: async (_args, ctx) => {
			// Make sure no run is in flight (e.g. a stalled turn we're recovering from).
			await ctx.waitForIdle();

			if (ctx.sessionManager.getEntries().length === 0) {
				ctx.ui.notify("Nothing to continue — the conversation is empty.", "warning");
				return;
			}

			// Hidden message only exists to trigger the agent loop; the `context`
			// handler above removes it before the request is built.
			pi.sendMessage(
				{
					customType: CONTINUE_TYPE,
					content: "",
					display: false,
				},
				{ triggerTurn: true },
			);
		},
	});
}
