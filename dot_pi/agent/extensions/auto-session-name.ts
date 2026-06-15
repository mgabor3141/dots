/**
 * Auto-name sessions by asking Haiku to generate a title from the first user message.
 *
 * The LLM call is made in-process via pi-ai's completeSimple rather than shelling
 * out to the `pi` CLI. The previous version spawned `pi -p`, which never set a name:
 * `pi -p` reads from a non-TTY stdin, and execFile left the child's stdin as an open
 * pipe, so the spawned process blocked forever waiting for EOF and the callback that
 * called setSessionName never ran. The in-process call sidesteps that entirely.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";

const PROVIDER = "anthropic";
const MODEL_ID = "claude-haiku-4-5";

export default function (pi: ExtensionAPI) {
	let named = false;

	pi.on("session_start", async () => {
		named = !!pi.getSessionName();
	});

	// Naming is best-effort, so kick it off detached and return immediately
	// rather than making the agent loop await the extra LLM round-trip.
	pi.on("agent_end", (event, ctx: ExtensionContext) => {
		// Skip if we've already named it, or if a name already exists (e.g. set
		// manually, or carried over from a forked/resumed session).
		if (named || pi.getSessionName()) return;
		named = true; // prevent retries on subsequent turns

		const userMsg = event.messages.find((m) => m.role === "user");
		if (!userMsg) return;
		const text =
			typeof userMsg.content === "string"
				? userMsg.content
				: userMsg.content
						.filter((b) => b.type === "text")
						.map((b) => (b as { text: string }).text)
						.join(" ");
		if (!text) return;

		void (async () => {
			try {
				const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
				if (!model) return;
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok || !auth.apiKey) return;

				const prompt = text.slice(0, 500);
				const result = await completeSimple(
					model,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: `Generate a brief session title (max 50 chars, no quotes) for this message:\n\n${prompt}`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 64, temperature: 0 },
				);

				const title = result.content
					.filter((b) => b.type === "text")
					.map((b) => (b as { text: string }).text)
					.join(" ")
					.trim()
					.replace(/^["']|["']$/g, "")
					.slice(0, 50);
				// Re-check: the LLM call is async, so a name may have appeared meanwhile.
				if (title && !pi.getSessionName()) pi.setSessionName(title);
			} catch {
				// Naming is best-effort; ignore failures.
			}
		})();
	});
}
