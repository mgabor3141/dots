/**
 * Send a system notification when the agent finishes and the terminal isn't focused.
 * Captures the compositor window ID at session start for precise focus tracking.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { captureWindowId, sendNotification } from "./lib/notify.js";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		await captureWindowId();
	});

	pi.on("agent_end", async (_event, ctx) => {
		await sendNotification({
			title: "Agent finished",
			body: "Ready for your next input",
			cwd: ctx.cwd,
		});
	});
}
