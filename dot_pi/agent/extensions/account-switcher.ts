/**
 * Account switcher for pi.
 *
 * Manages credential profiles across all providers so you can switch
 * between accounts (e.g., personal vs work) without re-logging in.
 *
 * Commands:
 *   /account           - switch to a different profile (interactive)
 *   /account <name>    - quick-switch to a named profile
 *   /account save      - save current credentials under a name
 *   /account rm        - remove a saved profile
 *
 * Each profile snapshots ALL provider credentials (Anthropic, GitHub
 * Copilot, OpenAI, etc.). Switching restores the full set.
 *
 * The key problem this solves: OAuth providers like Anthropic use refresh
 * token rotation, so saved profiles go stale when pi auto-refreshes
 * tokens in the background. By auto-saving the outgoing profile's
 * credentials before each switch, the latest refresh tokens are preserved.
 *
 * Writes directly to AuthStorage, so switched credentials take effect
 * immediately without restarting pi.
 */

import type { AuthStorageData, ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

type Profiles = Record<string, AuthStorageData>;

export default function (pi: ExtensionAPI) {
	const agentDir = join(process.env.HOME!, ".pi", "agent");
	const profilesPath = join(agentDir, "auth-profiles.json");
	const activePath = join(agentDir, "active-profile");

	// --- Profile persistence helpers ---

	function loadProfiles(): Profiles {
		if (!existsSync(profilesPath)) return {};
		return JSON.parse(readFileSync(profilesPath, "utf-8"));
	}

	function saveProfiles(profiles: Profiles) {
		writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), "utf-8");
		chmodSync(profilesPath, 0o600);
	}

	function getActiveLabel(): string | undefined {
		if (!existsSync(activePath)) return undefined;
		const label = readFileSync(activePath, "utf-8").trim();
		return label || undefined;
	}

	function setActiveLabel(label: string | undefined) {
		if (label) {
			writeFileSync(activePath, label, "utf-8");
		} else if (existsSync(activePath)) {
			writeFileSync(activePath, "", "utf-8");
		}
	}

	function getAllCredentials(ctx: ExtensionCommandContext): AuthStorageData {
		return ctx.modelRegistry.authStorage.getAll();
	}

	/**
	 * Save current credentials back to the active profile.
	 * Preserves refreshed tokens that pi wrote since the last switch.
	 */
	function autosaveActive(ctx: ExtensionCommandContext) {
		const active = getActiveLabel();
		if (!active) return;
		const profiles = loadProfiles();
		if (!(active in profiles)) return;
		const current = getAllCredentials(ctx);
		if (Object.keys(current).length === 0) return;
		profiles[active] = current;
		saveProfiles(profiles);
	}

	/**
	 * Apply a credential set: add/update providers in the profile,
	 * remove providers that exist in auth but not in the profile.
	 */
	function applyCredentials(ctx: ExtensionCommandContext, creds: AuthStorageData) {
		const auth = ctx.modelRegistry.authStorage;
		const currentProviders = new Set(auth.list());
		const newProviders = new Set(Object.keys(creds));

		// Set all providers from the profile
		for (const [provider, credential] of Object.entries(creds)) {
			auth.set(provider, credential);
		}

		// Remove providers that were in the old set but not the new one
		for (const provider of currentProviders) {
			if (!newProviders.has(provider)) {
				auth.remove(provider);
			}
		}
	}

	// --- Commands ---

	pi.registerCommand("account", {
		description: "Switch account profile (or: /account save, /account rm)",
		getArgumentCompletions: (prefix: string) => {
			const subs = ["save", "rm"];
			const profiles = Object.keys(loadProfiles());
			const all = [...subs, ...profiles];
			const filtered = all
				.filter((s) => s.startsWith(prefix))
				.map((s) => ({ value: s, label: s }));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const sub = parts[0];

			if (sub === "save") {
				await handleSave(parts[1], ctx);
			} else if (sub === "rm") {
				await handleRm(parts[1], ctx);
			} else if (sub) {
				await handleUse(sub, ctx);
			} else {
				await handleInteractiveSwitch(ctx);
			}
		},
	});

	async function handleInteractiveSwitch(ctx: ExtensionCommandContext) {
		const profiles = loadProfiles();
		const labels = Object.keys(profiles);
		if (labels.length === 0) {
			// Guide first-time setup: save current credentials as a profile
			const label = (await ctx.ui.input("No profiles yet. Save current credentials as:"))?.trim();
			if (label) await handleSave(label, ctx);
			return;
		}

		const active = getActiveLabel();
		const items = labels.map((l) => {
			const providers = Object.keys(profiles[l]).join(", ");
			const prefix = l === active ? "* " : "  ";
			return `${prefix}${l}  (${providers})`;
		});

		const choice = await ctx.ui.select("Switch account:", items);
		if (choice === undefined) return;

		const label = labels[items.indexOf(choice)];
		if (label === active) {
			ctx.ui.notify(`Already on '${label}'.`, "info");
			return;
		}

		await handleUse(label, ctx);
	}

	async function handleUse(label: string, ctx: ExtensionCommandContext) {
		const profiles = loadProfiles();
		if (!(label in profiles)) {
			const available = Object.keys(profiles).join(", ") || "(none)";
			ctx.ui.notify(`No profile '${label}'. Available: ${available}`, "error");
			return;
		}

		// Auto-save outgoing credentials to preserve refreshed tokens
		autosaveActive(ctx);

		// Apply the new credential set
		applyCredentials(ctx, profiles[label]);

		setActiveLabel(label);
		ctx.ui.notify(`Switched to '${label}'.`, "success");
	}

	async function handleSave(name: string | undefined, ctx: ExtensionCommandContext) {
		let label = name;
		if (!label) {
			label = (await ctx.ui.input("Profile name:"))?.trim();
		}
		if (!label) {
			ctx.ui.notify("No name provided.", "warning");
			return;
		}

		const current = getAllCredentials(ctx);
		if (Object.keys(current).length === 0) {
			ctx.ui.notify("No credentials in auth storage to save.", "error");
			return;
		}

		const profiles = loadProfiles();
		const overwriting = label in profiles;

		profiles[label] = current;
		saveProfiles(profiles);
		setActiveLabel(label);

		const providers = Object.keys(current).join(", ");
		const verb = overwriting ? "Updated" : "Saved";
		const profileCount = Object.keys(profiles).length;
		let msg = `${verb} profile '${label}' (${providers}).`;
		if (profileCount === 1) {
			msg += " Now /login to your other account, then /account save <name>.";
		}
		ctx.ui.notify(msg, "success");
	}

	async function handleRm(name: string | undefined, ctx: ExtensionCommandContext) {
		let label = name;
		if (!label) {
			const profiles = loadProfiles();
			const labels = Object.keys(profiles);
			if (labels.length === 0) {
				ctx.ui.notify("No profiles to remove.", "warning");
				return;
			}
			label = await ctx.ui.select("Remove profile:", labels);
		}
		if (!label) return;

		const profiles = loadProfiles();
		if (!(label in profiles)) {
			ctx.ui.notify(`No profile '${label}'.`, "error");
			return;
		}

		const ok = await ctx.ui.confirm("Remove profile", `Delete '${label}'?`);
		if (!ok) return;

		delete profiles[label];
		saveProfiles(profiles);

		if (getActiveLabel() === label) {
			setActiveLabel(undefined);
		}

		ctx.ui.notify(`Removed profile '${label}'.`, "success");
	}

}
