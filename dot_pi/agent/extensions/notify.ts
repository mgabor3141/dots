/**
 * Send a system notification when the agent finishes and the terminal isn't focused.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { sendNotification } from "./lib/notify.js";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		await sendNotification({
			title: "Agent finished",
			body: "Ready for your next input",
			cwd: ctx.cwd,
		});
	});
}
