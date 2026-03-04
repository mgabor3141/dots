/**
 * Cross-platform notification helper with window-level focus tracking.
 *
 * Call captureWindowId() once at session start (while the terminal is focused)
 * to grab the compositor window ID. Subsequent notifications use that ID for:
 *   - Foreground suppression (skip notification if our window is focused)
 *   - Click-to-focus (focus our exact window, not just the app)
 *
 * Falls back to app-level matching when window ID is unavailable.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Window ID capture ────────────────────────────────────────────────────────

interface WindowHandle {
	compositor: "niri" | "sway" | "hyprland" | "macos";
	/** Compositor-specific window identifier */
	id: string;
}

let capturedWindow: WindowHandle | null = null;

/**
 * Capture the currently focused window's ID from the compositor.
 * Call this at session start when the terminal is guaranteed to be focused.
 */
export async function captureWindowId(): Promise<void> {
	try {
		if (process.platform === "darwin") {
			// On macOS, we use the bundle ID + window ID via AppleScript
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

// ── Foreground detection ─────────────────────────────────────────────────────

async function isForeground(): Promise<boolean> {
	if (!capturedWindow) return false;

	try {
		switch (capturedWindow.compositor) {
			case "niri": {
				const { stdout } = await execFileAsync("niri", ["msg", "--json", "focused-window"], { timeout: 2000 });
				return String(JSON.parse(stdout).id) === capturedWindow.id;
			}
			case "sway": {
				const { stdout } = await execFileAsync("swaymsg", ["-t", "get_tree"], { timeout: 2000 });
				const focused = findFocused(JSON.parse(stdout));
				return String(focused?.id) === capturedWindow.id;
			}
			case "hyprland": {
				const { stdout } = await execFileAsync("hyprctl", ["activewindow", "-j"], { timeout: 2000 });
				return JSON.parse(stdout).address === capturedWindow.id;
			}
			case "macos": {
				const { stdout } = await execFileAsync("osascript", [
					"-e",
					'tell application "System Events" to return bundle identifier of first application process whose frontmost is true',
				], { timeout: 2000 });
				return stdout.trim() === capturedWindow.id;
			}
		}
	} catch {}

	return false;
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

// ── Sway tree walker ─────────────────────────────────────────────────────────

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
	/** Skip notification if our window is focused (default true) */
	skipIfForeground?: boolean;
}

export async function sendNotification(opts: NotifyOptions): Promise<void> {
	const { title, body, cwd = process.cwd(), skipIfForeground = true } = opts;

	if (skipIfForeground && (await isForeground())) return;

	if (process.platform === "darwin") {
		await notifyMacOS(title, body, cwd);
	} else if (process.platform === "linux") {
		notifyLinux(title, body);
	}
}
