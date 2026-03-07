/**
 * Sudo extension for pi
 *
 * Instead of blocking sudo in bash, injects SUDO_ASKPASS into the environment
 * so sudo pops up a GUI dialog (zenity) when there's no TTY. Over SSH or
 * headless, falls back to blocking with guidance to use interactive_shell.
 *
 * Also notifies on interactive_shell opens.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashTool, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { sendNotification } from "./lib/notify.js";
import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ASKPASS_PATH = join(process.env.HOME ?? "", ".local/bin/sudo-askpass");

function hasDisplay(): boolean {
	if (process.env.WAYLAND_DISPLAY || process.env.DISPLAY) return true;

	// Check for a Wayland socket (e.g. SSH into a machine with a running compositor)
	const uid = process.getuid?.();
	if (uid == null) return false;
	const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
	try {
		return readdirSync(runtimeDir).some((f) => f.startsWith("wayland-") && !f.includes(".lock"));
	} catch {
		return false;
	}
}

/**
 * Check if a command invokes sudo in a command position (not inside quotes).
 * Strips single-quoted, double-quoted, and $'...' strings, plus comments,
 * then checks for sudo as a command word (start of line, after ;, &&, ||, |, or ().
 */
function hasSudoCommand(command: string): boolean {
	const stripped = command
		.replace(/\\./g, "")
		.replace(/\$'[^']*'/g, "''")
		.replace(/'[^']*'/g, "''")
		.replace(/"[^"]*"/g, '""')
		.replace(/#.*/g, "");
	return /(?:^|[;&|`(])\s*sudo\b/.test(stripped);
}

export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
	});

	const askpassAvailable = existsSync(ASKPASS_PATH);

	if (askpassAvailable) {
		// Override bash tool to inject SUDO_ASKPASS into the environment.
		// sudo automatically uses askpass when there's no TTY.
		const bashTool = createBashTool(cwd, {
			spawnHook: ({ command, cwd: spawnCwd, env }) => ({
				command,
				cwd: spawnCwd,
				env: {
					...env,
					SUDO_ASKPASS: ASKPASS_PATH,
					// Pass the full command to askpass so it can show what's being approved
					SUDO_ASKPASS_COMMAND: command,
				},
			}),
		});

		pi.registerTool({
			...bashTool,
			execute: async (id, params, signal, onUpdate, ctx) => {
				cwd = ctx.cwd;

				// If there's no display and the command uses sudo, block — askpass
				// needs a display to show the password dialog
				if (!hasDisplay() && hasSudoCommand(params.command)) {
					return {
						content: [
							{
								type: "text" as const,
								text: [
									"No display available for sudo password prompt.",
									"Use the interactive_shell tool instead:",
									'  interactive_shell({ command: "sudo ...", mode: "hands-free", handsFree: { autoExitOnQuiet: true, quietThreshold: 15000 } })',
								].join("\n"),
							},
						],
						isError: true,
					};
				}

				return bashTool.execute(id, params, signal, onUpdate);
			},
		});
	} else {
		// No askpass script — block sudo with guidance
		pi.on("tool_call", async (event, ctx) => {
			cwd = ctx.cwd;
			if (!isToolCallEventType("bash", event)) return;
			if (!hasSudoCommand(event.input.command)) return;

			return {
				block: true,
				reason: [
					"sudo-askpass is not installed at " + ASKPASS_PATH,
					"Use the interactive_shell tool instead:",
					'  interactive_shell({ command: "sudo ...", mode: "hands-free", handsFree: { autoExitOnQuiet: true, quietThreshold: 15000 } })',
				].join("\n"),
			};
		});
	}

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
