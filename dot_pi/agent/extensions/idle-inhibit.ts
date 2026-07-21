/**
 * Idle Inhibitor — prevents system idle (screen lock, suspend) while an agent is running.
 * Uses systemd-inhibit to hold an idle lock for the duration of each agent invocation.
 *
 * The inhibitor is held by a `systemd-inhibit ... cat` child whose stdin is a pipe
 * owned by this pi process. systemd-inhibit holds the logind lock for as long as the
 * command runs, and `cat` runs until it sees EOF on stdin. Because the write end of
 * the pipe lives in this pi process, the kernel closes it automatically when pi exits
 * — by ANY means, including SIGKILL, a crash, or the terminal closing (SIGHUP). `cat`
 * then reads EOF, exits, and systemd-inhibit releases the lock. No lockfiles, no PID
 * bookkeeping, no stale-cleanup pass: a dangling inhibitor cannot outlive its pi.
 *
 * Graceful paths are handled explicitly by release():
 *   - agent_end        — normal end of an agent loop, and also aborted turns
 *                        (agent-loop emits agent_end when stopReason === "aborted")
 *   - session_shutdown — the session is quitting
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";

export default function (pi: ExtensionAPI) {
	let inhibitor: ChildProcess | null = null;

	function acquire() {
		// At most one inhibitor per session. Replace any previous one (shouldn't
		// happen in normal flow, but keep it idempotent).
		if (inhibitor) release();

		// stdin is a pipe held by this process; stdout/stderr discarded. When pi
		// dies for any reason, the pipe's write end closes, `cat` hits EOF and
		// exits, and systemd-inhibit drops the lock. See file header.
		inhibitor = spawn(
			"systemd-inhibit",
			["--what=idle", "--who=pi", "--why=AI agent running", "--mode=block", "cat"],
			{ stdio: ["pipe", "ignore", "ignore"], detached: false },
		);

		// Swallow errors on the stdin pipe (e.g. EPIPE if the child is already gone)
		// so they never crash the host process.
		inhibitor.stdin?.on("error", () => {});
		inhibitor.on("error", () => {
			inhibitor = null;
		});
		inhibitor.on("exit", () => {
			inhibitor = null;
		});
	}

	function release() {
		if (!inhibitor) return;
		const child = inhibitor;
		inhibitor = null;
		// Closing stdin lets `cat` exit cleanly (releasing the lock); kill is a
		// belt-and-suspenders in case the pipe write already failed.
		try {
			child.stdin?.end();
		} catch {}
		child.kill();
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
