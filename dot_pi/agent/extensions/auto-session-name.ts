/**
 * Auto-name sessions by asking Haiku to generate a title from the first user message.
 * Runs in the background so it doesn't block the conversation.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";

const MODEL = "anthropic/claude-haiku-4-5";

export default function (pi: ExtensionAPI) {
	let named = false;

	pi.on("session_start", async () => {
		named = !!pi.getSessionName();
	});

	pi.on("agent_end", async (event) => {
		if (named) return;
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

		// Fire and forget — don't block the conversation
		const prompt = text.slice(0, 500);
		const child = execFile(
			"pi",
			[
				"--model", MODEL,
				"--no-tools",
				"--no-extensions",
				"--no-skills",
				"--no-session",
				"--thinking", "off",
				"-p",
				`Generate a brief session title (max 50 chars, no quotes) for this message:\n\n${prompt}`,
			],
			{ timeout: 10_000 },
			(err, stdout) => {
				if (err || !stdout.trim()) return;
				const title = stdout.trim().slice(0, 50);
				pi.setSessionName(title);
			},
		);
		child.unref();
	});
}
