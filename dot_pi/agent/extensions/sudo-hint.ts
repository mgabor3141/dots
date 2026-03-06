/**
 * Hints for sudo and interactive shell usage.
 *
 * - Redirects sudo in bash → interactive_shell (bash has no TTY for password)
 * - Notifies on interactive_shell open (user may need to interact)
 *
 * This is a best-effort hint, not a security boundary. Missing cases is fine
 * (the command would just fail on password prompt); false positives are not.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { sendNotification } from "./lib/notify.js";

/**
 * Check if a command invokes sudo in a command position (not inside quotes).
 * Strips single-quoted, double-quoted, and $'...' strings, plus comments,
 * then checks for sudo as a command word (start of line, after ;, &&, ||, |, or ().
 */
function hasSudoCommand(command: string): boolean {
	// Strip quoted strings and comments to avoid matching sudo inside arguments
	const stripped = command
		.replace(/\\./g, "")                   // remove escaped chars first
		.replace(/\$'[^']*'/g, "''")           // $'...' strings
		.replace(/'[^']*'/g, "''")             // single-quoted strings
		.replace(/"[^"]*"/g, '""')             // double-quoted strings
		.replace(/#.*/g, "");                  // comments
	// Check for sudo in command position
	return /(?:^|[;&|`(])\s*sudo\b/.test(stripped);
}

export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
	});

	pi.on("tool_call", async (event, ctx) => {
		cwd = ctx.cwd;
		if (!isToolCallEventType("bash", event)) return;
		if (!hasSudoCommand(event.input.command)) return;

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
}
