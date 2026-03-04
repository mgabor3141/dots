/**
 * Cross-platform system notification helper with click-to-focus.
 *
 * - Linux: notify-send with gdbus activation to focus the terminal window
 * - macOS: terminal-notifier with -activate / -execute for window focus
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Linux ────────────────────────────────────────────────────────────────────

/**
 * Get the window-system app ID for click-to-focus on Linux.
 * Checks the Wayland app-id first, then falls back to WM_CLASS for X11.
 */
function getLinuxAppId(): string | undefined {
	// Wayland: some terminals set this
	if (process.env.WAYLAND_DISPLAY) {
		// For most terminals the app-id matches the .desktop file name
		// e.g. "org.wezfurlong.wezterm", "kitty", "Alacritty", "foot"
		// We can detect some from env vars:
		if (process.env.WEZTERM_PANE !== undefined) return "org.wezfurlong.wezterm";
		if (process.env.KITTY_PID) return "kitty";
		if (process.env.ALACRITTY_SOCKET) return "Alacritty";
		if (process.env.FOOT_SOCK) return "foot";
		if (process.env.ZED_TERM) return "dev.zed.Zed";
	}
	return undefined;
}

/**
 * Focus a window by app-id on Linux using gdbus → the compositor.
 * Works on GNOME/Mutter and wlroots compositors with org.freedesktop.portal.
 */
function focusLinuxWindow(appId: string): void {
	// Try xdg-activation via gtk-launch as a simple portable approach
	execFile("gtk-launch", [`${appId}.desktop`], () => {});
}

function notifyLinux(title: string, body: string): void {
	const appId = getLinuxAppId();
	const args = ["--app-name=Pi", "--urgency=critical", title, body];

	if (appId) {
		// Add a default action that focuses the terminal
		args.push("--action=default=Focus terminal");
	}

	const proc = execFile("notify-send", args, () => {});

	// notify-send with --action prints the action name when clicked
	if (appId && proc.stdout) {
		proc.stdout.on("data", (data: Buffer) => {
			if (data.toString().trim() === "default") {
				focusLinuxWindow(appId);
			}
		});
	}
}

// ── macOS ────────────────────────────────────────────────────────────────────

function getBundleId(): string | undefined {
	return process.env.__CFBundleIdentifier || undefined;
}

function getAppName(bundleId: string): string {
	return bundleId.split(".").pop() ?? bundleId;
}

async function resolveCommand(name: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("which", [name], { timeout: 1000 });
		return stdout.trim() || name;
	} catch {
		return name;
	}
}

async function buildClickCommand(bundleId: string, cwd: string): Promise<string> {
	if (process.env.ZED_TERM) {
		const zedPath = await resolveCommand("zed");
		return `${zedPath} ${cwd}`;
	}
	const appName = getAppName(bundleId);
	return `osascript -e 'tell application "${appName}" to activate'`;
}

async function notifyMacOS(title: string, body: string, cwd: string): Promise<void> {
	const bundleId = getBundleId();
	if (!bundleId) return;

	const args = ["-title", "Pi", "-subtitle", title, "-message", body, "-sound", "default", "-ignoreDnD"];

	if (process.env.ZED_TERM) {
		args.push("-execute", await buildClickCommand(bundleId, cwd));
	} else {
		args.push("-activate", bundleId);
	}

	execFile("terminal-notifier", args, () => {});
}

// ── macOS foreground check ───────────────────────────────────────────────────

async function isForegroundMacOS(): Promise<boolean> {
	const bundleId = getBundleId();
	if (!bundleId) return false;
	try {
		const { stdout } = await execFileAsync("osascript", [
			"-e",
			'tell application "System Events" to return bundle identifier of first application process whose frontmost is true',
		], { timeout: 2000 });
		return stdout.trim() === bundleId;
	} catch {
		return false;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface NotifyOptions {
	title: string;
	body: string;
	/** cwd for macOS click-to-focus (defaults to process.cwd()) */
	cwd?: string;
	/** Skip notification if terminal is focused (macOS only, default true) */
	skipIfForeground?: boolean;
}

export async function sendNotification(opts: NotifyOptions): Promise<void> {
	const { title, body, cwd = process.cwd(), skipIfForeground = true } = opts;

	if (process.platform === "darwin") {
		if (skipIfForeground && (await isForegroundMacOS())) return;
		await notifyMacOS(title, body, cwd);
	} else if (process.platform === "linux") {
		notifyLinux(title, body);
	}
}
