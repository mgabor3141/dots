/**
 * Auto-name sessions by asking a small model to generate a title from the first
 * user message. The model is picked from $PI_LIBRARIAN_MODELS (see resolveModel).
 *
 * The LLM call is made in-process via pi-ai's completeSimple rather than shelling
 * out to the `pi` CLI. The previous version spawned `pi -p`, which never set a name:
 * `pi -p` reads from a non-TTY stdin, and execFile left the child's stdin as an open
 * pipe, so the spawned process blocked forever waiting for EOF and the callback that
 * called setSessionName never ran. The in-process call sidesteps that entirely.
 */
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";

// Reuse the librarian's model list (for now). Format is a comma-separated list
// of "provider/model[:effort]" entries, e.g.
//   mgabor/default:medium,openai-codex/gpt-5.5:medium,anthropic/claude-sonnet-4-6:high
// We use the first entry that the model registry can resolve.
const MODELS_ENV = "PI_LIBRARIAN_MODELS";
const FALLBACK = "anthropic/claude-haiku-4-5";

function resolveModel(registry: ModelRegistry) {
	const entries = (process.env[MODELS_ENV] || "")
		.split(",")
		.map((e) => e.trim())
		.filter(Boolean);
	entries.push(FALLBACK);
	for (const entry of entries) {
		const spec = entry.split(":")[0]; // strip optional ":effort"
		const slash = spec.indexOf("/");
		if (slash < 0) continue;
		const model = registry.find(spec.slice(0, slash), spec.slice(slash + 1));
		if (model) return model;
	}
	return undefined;
}

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
				const model = resolveModel(ctx.modelRegistry);
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
