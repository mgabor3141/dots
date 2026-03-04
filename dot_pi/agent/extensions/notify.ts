/**
 * Notification extension:
 * - Captures compositor window ID at session start (for click-to-focus)
 * - Enables DECSET 1004 terminal focus tracking (for suppression)
 * - Sends notification on agent_end if terminal isn't focused
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { startFocusTracking, stopFocusTracking } from "./lib/focus.js";
import { captureWindowId, sendNotification } from "./lib/notify.js";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		await captureWindowId();
		startFocusTracking();
	});

	pi.on("session_shutdown", async () => {
		stopFocusTracking();
	});

	pi.on("agent_end", async (_event, ctx) => {
		await sendNotification({
			title: "Agent finished",
			body: "Ready for your next input",
			cwd: ctx.cwd,
		});
	});
}
