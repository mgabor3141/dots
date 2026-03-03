import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Detect the bundle identifier of the terminal app we're running inside.
 * macOS sets __CFBundleIdentifier for GUI apps.
 */
function getBundleId(): string | undefined {
	return process.env.__CFBundleIdentifier || undefined;
}

/**
 * Get the process name from a bundle ID (e.g., "dev.zed.Zed" -> "Zed").
 */
function getAppName(bundleId: string): string {
	return bundleId.split(".").pop() ?? bundleId;
}

/**
 * Check if the terminal app is the frontmost application (macOS).
 */
async function isForeground(bundleId: string): Promise<boolean> {
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

/**
 * Resolve the full path of a command, so -execute works without the user's PATH.
 */
async function resolveCommand(name: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("which", [name], { timeout: 1000 });
		return stdout.trim() || name;
	} catch {
		return name;
	}
}

/**
 * Build the -execute command for terminal-notifier click action.
 * For Zed: use `zed <cwd>` to focus the correct window.
 * For others: use `osascript` to activate the app by name.
 */
async function buildClickCommand(bundleId: string, cwd: string): Promise<string> {
	if (process.env.ZED_TERM) {
		// Zed: open the project folder, which focuses the correct window
		const zedPath = await resolveCommand("zed");
		return `${zedPath} ${cwd}`;
	}
	// Generic: activate the app via AppleScript
	const appName = getAppName(bundleId);
	return `osascript -e 'tell application "${appName}" to activate'`;
}

/**
 * Send a notification via terminal-notifier (macOS).
 */
async function notifyMacOS(bundleId: string, cwd: string, ctx?: ExtensionContext): Promise<void> {
	const args = [
		"-title", "Pi",
		"-subtitle", "Agent finished",
		"-message", "Ready for your next input",
		"-sound", "default",
		"-ignoreDnD",
	];

	if (process.env.ZED_TERM) {
		// Zed: use -execute for window-level targeting (-activate conflicts with it)
		args.push("-execute", await buildClickCommand(bundleId, cwd));
	} else {
		// Other terminals: use -activate for app-level focus
		args.push("-activate", bundleId);
	}

	execFile("terminal-notifier", args, (error) => {
		if (!error) return;
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			ctx?.ui?.notify("terminal-notifier not found. Install with: brew install terminal-notifier", "error");
		} else {
			ctx?.ui?.notify(`terminal-notifier failed: ${error.message}`, "error");
		}
	});
}

/**
 * Send a notification via notify-send (Linux).
 */
function notifyLinux(ctx?: ExtensionContext): void {
	execFile("notify-send", [
		"--app-name=Pi",
		"Agent finished",
		"Ready for your next input",
	], (error) => {
		if (!error) return;
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			ctx?.ui?.notify("notify-send not found. Install libnotify.", "error");
		} else {
			ctx?.ui?.notify(`notify-send failed: ${error.message}`, "error");
		}
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		if (process.platform === "darwin") {
			const bundleId = getBundleId();
			if (!bundleId) return;

			// Skip if the terminal is already focused
			if (await isForeground(bundleId)) return;

			notifyMacOS(bundleId, ctx.cwd, ctx);
		} else if (process.platform === "linux") {
			notifyLinux(ctx);
		}
	});
}
