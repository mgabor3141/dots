/**
 * - Intercept sudo in bash → block with reason to use interactive_shell
 * - Notify on any interactive_shell open (user may need to interact)
 * - Notify on guardrails approve/deny dialog
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { sendNotification } from "./lib/notify.js";

const SUDO_RE = /\bsudo\b/;

export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
	});

	pi.on("tool_call", async (event, ctx) => {
		cwd = ctx.cwd;
		if (!isToolCallEventType("bash", event)) return;
		if (!SUDO_RE.test(event.input.command)) return;

		return {
			block: true,
			reason: [
				"sudo commands cannot run in the bash tool because it has no TTY for password entry.",
				"Use the interactive_shell tool instead:",
				'  interactive_shell({ command: "sudo ...", mode: "hands-free", handsFree: { autoExitOnQuiet: true, quietThreshold: 15000 } })',
				"The user can then enter their password in the interactive overlay.",
			].join("\n"),
		};
	});

	pi.on("tool_execution_start", async (event, _ctx) => {
		if (event.toolName !== "interactive_shell") return;
		const cmd = (event.args as Record<string, unknown>)?.command;
		if (typeof cmd !== "string") return;
		const short = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
		await sendNotification({
			title: "🖥️ Interactive shell opened",
			body: short,
			cwd,
			skipIfForeground: false,
		});
	});

	pi.events.on("guardrails:dangerous", (event: { command?: string; description?: string }) => {
		const desc = event.description || "dangerous command";
		const cmd = event.command || "";
		const short = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
		sendNotification({
			title: "⚠️ Approve command?",
			body: `${desc}: ${short}`,
			cwd,
			skipIfForeground: false,
		});
	});
}
