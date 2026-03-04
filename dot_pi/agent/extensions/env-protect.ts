/**
 * .env file protection with approve/deny dialog.
 *
 * Unlike guardrails policies (which hard-block), this shows a confirm dialog
 * for any tool accessing .env files, letting you approve or deny each access.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";

const ENV_PATTERNS = [".env", ".env.local", ".env.production", ".env.prod", ".dev.vars"];
const ENV_SAFE = [".env.example", ".env.sample", ".env.test"];

function isEnvFile(filePath: string): boolean {
	const base = path.basename(filePath);
	if (ENV_SAFE.some((s) => base === path.basename(s))) return false;
	return ENV_PATTERNS.some((p) => base === path.basename(p) || base.startsWith(path.basename(p) + "."));
}

export default function (pi: ExtensionAPI) {
	const sessionAllowed = new Set<string>();

	pi.on("session_start", async () => {
		sessionAllowed.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		let target: string | undefined;

		if (isToolCallEventType("read", event)) target = event.input.path;
		else if (isToolCallEventType("write", event)) target = event.input.path;
		else if (isToolCallEventType("edit", event)) target = event.input.path;

		if (!target || !isEnvFile(target)) return;

		const resolved = path.resolve(ctx.cwd, target);
		if (sessionAllowed.has(resolved)) return;

		if (!ctx.hasUI) {
			return { block: true, reason: `Protected file: ${target} (no UI to confirm)` };
		}

		const choice = await ctx.ui.select(`🛡️ ${event.toolName} on ${target}`, ["Allow", "Allow for session", "Deny"]);

		if (choice === "Allow for session") {
			sessionAllowed.add(resolved);
			return;
		}
		if (choice === "Allow") return;
		return { block: true, reason: `Access to ${target} denied by user` };
	});
}
