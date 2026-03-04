/**
 * Cross-platform notification helper.
 *
 * Uses terminal focus tracking (DECSET 1004 via lib/focus.ts) to suppress
 * notifications when the terminal is focused. On notification click, focuses
 * the compositor window captured at session start.
 *
 * - Linux: notify-send with compositor-specific click-to-focus
 * - macOS: terminal-notifier with -activate / -execute
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isTerminalFocused } from "./focus.js";

const execFileAsync = promisify(execFile);

// ── Window ID for click-to-focus ─────────────────────────────────────────────

interface WindowHandle {
	compositor: "niri" | "sway" | "hyprland" | "macos";
	id: string;
}

let capturedWindow: WindowHandle | null = null;

/**
 * Capture the currently focused window's ID from the compositor.
 * Call at session start when the terminal is guaranteed to be focused.
 */
export async function captureWindowId(): Promise<void> {
	try {
		if (process.platform === "darwin") {
			const bundleId = process.env.__CFBundleIdentifier;
			if (bundleId) {
				capturedWindow = { compositor: "macos", id: bundleId };
			}
			return;
		}

		if (process.env.NIRI_SOCKET) {
			const { stdout } = await execFileAsync("niri", ["msg", "--json", "focused-window"], { timeout: 2000 });
			const win = JSON.parse(stdout);
			if (win.id != null) {
				capturedWindow = { compositor: "niri", id: String(win.id) };
			}
		} else if (process.env.SWAYSOCK) {
			const { stdout } = await execFileAsync("swaymsg", ["-t", "get_tree"], { timeout: 2000 });
			const focused = findFocused(JSON.parse(stdout));
			if (focused?.id != null) {
				capturedWindow = { compositor: "sway", id: String(focused.id) };
			}
		} else if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
			const { stdout } = await execFileAsync("hyprctl", ["activewindow", "-j"], { timeout: 2000 });
			const win = JSON.parse(stdout);
			if (win.address) {
				capturedWindow = { compositor: "hyprland", id: win.address };
			}
		}
	} catch {}
}

// ── Focus window ─────────────────────────────────────────────────────────────

function focusWindow(): void {
	if (!capturedWindow) return;

	try {
		switch (capturedWindow.compositor) {
			case "niri":
				execFile("niri", ["msg", "action", "focus-window", "--id", capturedWindow.id], () => {});
				break;
			case "sway":
				execFile("swaymsg", [`[con_id=${capturedWindow.id}] focus`], () => {});
				break;
			case "hyprland":
				execFile("hyprctl", ["dispatch", "focuswindow", `address:${capturedWindow.id}`], () => {});
				break;
			case "macos": {
				const appName = capturedWindow.id.split(".").pop() ?? capturedWindow.id;
				execFile("osascript", ["-e", `tell application "${appName}" to activate`], () => {});
				break;
			}
		}
	} catch {}
}

function findFocused(node: any): any {
	if (node.focused) return node;
	for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) {
		const found = findFocused(child);
		if (found) return found;
	}
	return null;
}

// ── Linux notification ───────────────────────────────────────────────────────

function notifyLinux(title: string, body: string): void {
	const args = ["--app-name=Pi", "--urgency=critical", title, body];

	if (capturedWindow) {
		args.push("--action=default=Focus terminal");
	}

	const proc = execFile("notify-send", args, () => {});

	if (capturedWindow && proc.stdout) {
		proc.stdout.on("data", (data: Buffer) => {
			if (data.toString().trim() === "default") {
				focusWindow();
			}
		});
	}
}

// ── macOS notification ───────────────────────────────────────────────────────

async function notifyMacOS(title: string, body: string, cwd: string): Promise<void> {
	const bundleId = process.env.__CFBundleIdentifier;
	if (!bundleId) return;

	const args = ["-title", "Pi", "-subtitle", title, "-message", body, "-sound", "default", "-ignoreDnD"];

	if (process.env.ZED_TERM) {
		let zedPath: string;
		try {
			const { stdout } = await execFileAsync("which", ["zed"], { timeout: 1000 });
			zedPath = stdout.trim() || "zed";
		} catch {
			zedPath = "zed";
		}
		args.push("-execute", `${zedPath} ${cwd}`);
	} else {
		args.push("-activate", bundleId);
	}

	execFile("terminal-notifier", args, () => {});
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface NotifyOptions {
	title: string;
	body: string;
	/** cwd for macOS click-to-focus (defaults to process.cwd()) */
	cwd?: string;
	/** Skip notification if terminal is focused (default true) */
	skipIfFocused?: boolean;
}

export async function sendNotification(opts: NotifyOptions): Promise<void> {
	const { title, body, cwd = process.cwd(), skipIfFocused = true } = opts;

	if (skipIfFocused && isTerminalFocused()) return;

	if (process.platform === "darwin") {
		await notifyMacOS(title, body, cwd);
	} else if (process.platform === "linux") {
		notifyLinux(title, body);
	}
}
