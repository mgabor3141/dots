/**
 * Idle Inhibitor — prevents system idle (screen lock, suspend) while an agent is running.
 * Uses systemd-inhibit to hold an idle lock for the duration of each agent invocation.
 *
 * Each pi session writes a lockfile at /tmp/pi-idle-inhibit-<pid>.pid containing the
 * inhibitor child PID. On startup, any lockfile whose owning pi PID is no longer running
 * is treated as stale: the inhibitor child is killed and the lockfile removed.
 *
 * This covers:
 *   - pi killed with SIGKILL (child orphaned, PPID becomes 1)
 *   - pi exited/crashed without firing session_shutdown (lockfile left behind)
 *
 * It does NOT cover a pi session that is still running but whose agent ended without
 * properly firing agent_end — that requires the owning session to clean itself up.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_DIR = "/tmp";
const LOCK_PREFIX = "pi-idle-inhibit-";
const myLockFile = join(LOCK_DIR, `${LOCK_PREFIX}${process.pid}.pid`);

/**
 * Scan for lockfiles left by other pi sessions. If the pi PID encoded in the
 * filename is no longer alive, terminate its inhibitor child and remove the file.
 */
function cleanupStaleInhibitors() {
	let files: string[];
	try {
		files = readdirSync(LOCK_DIR).filter((f) => f.startsWith(LOCK_PREFIX) && f.endsWith(".pid"));
	} catch {
		return;
	}

	for (const file of files) {
		const piPid = parseInt(file.slice(LOCK_PREFIX.length, -4), 10);
		if (piPid === process.pid || isNaN(piPid)) continue;

		if (!existsSync(`/proc/${piPid}`)) {
			// The pi session that owned this inhibitor is gone — clean it up
			try {
				const inhibitorPid = parseInt(readFileSync(join(LOCK_DIR, file), "utf-8").trim(), 10);
				if (!isNaN(inhibitorPid)) process.kill(inhibitorPid, "SIGTERM");
			} catch {}
			try {
				unlinkSync(join(LOCK_DIR, file));
			} catch {}
		}
	}
}

export default function (pi: ExtensionAPI) {
	let inhibitor: ChildProcess | null = null;

	cleanupStaleInhibitors();

	function acquire() {
		// Enforce at most one inhibitor per session. If a previous one is somehow
		// still tracked (shouldn't happen in normal flow), kill it before replacing.
		if (inhibitor) {
			inhibitor.kill();
			inhibitor = null;
			try {
				unlinkSync(myLockFile);
			} catch {}
		}

		inhibitor = spawn("systemd-inhibit", ["--what=idle", "--who=pi", "--why=AI agent running", "--mode=block", "sleep", "infinity"], {
			stdio: "ignore",
			detached: false,
		});

		// pid is available synchronously after spawn()
		if (inhibitor.pid) {
			try {
				writeFileSync(myLockFile, String(inhibitor.pid));
			} catch {}
		}

		inhibitor.on("error", () => {
			inhibitor = null;
			try {
				unlinkSync(myLockFile);
			} catch {}
		});
		inhibitor.on("exit", () => {
			inhibitor = null;
			try {
				unlinkSync(myLockFile);
			} catch {}
		});
	}

	function release() {
		if (!inhibitor) return;
		inhibitor.kill();
		inhibitor = null;
		try {
			unlinkSync(myLockFile);
		} catch {}
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
