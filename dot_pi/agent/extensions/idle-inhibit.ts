/**
 * Idle Inhibitor — prevents system idle (screen lock, suspend) while an agent is running.
 * Uses systemd-inhibit to hold an idle lock for the duration of each agent invocation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";

export default function (pi: ExtensionAPI) {
	let inhibitor: ChildProcess | null = null;

	function acquire() {
		if (inhibitor) return;
		inhibitor = spawn("systemd-inhibit", ["--what=idle", "--who=pi", "--why=AI agent running", "--mode=block", "sleep", "infinity"], {
			stdio: "ignore",
			detached: false,
		});
		inhibitor.on("error", () => {
			inhibitor = null;
		});
		inhibitor.on("exit", () => {
			inhibitor = null;
		});
	}

	function release() {
		if (!inhibitor) return;
		inhibitor.kill();
		inhibitor = null;
	}

	pi.on("agent_start", async () => {
		acquire();
	});

	pi.on("agent_end", async () => {
		release();
	});

	pi.on("session_shutdown", async () => {
		release();
	});
}
