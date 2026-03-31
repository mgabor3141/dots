/**
 * Account switcher for pi.
 *
 * Manages credential profiles across all providers so you can switch
 * between accounts (e.g., personal vs work) without re-logging in.
 *
 * Commands:
 *   /account           - switch to a different profile (interactive)
 *   /account <name>    - quick-switch to a named profile
 *   /account name      - rename the active profile
 *   /account rm        - remove a saved profile
 *
 * New logins are detected automatically: a file watcher on auth.json
 * notices credential changes while the agent is idle (token refreshes
 * only happen during API calls, so idle changes indicate /login). New
 * profiles get a random name; use /account name to rename.
 *
 * Token refresh is handled transparently: credential changes during
 * agent activity are auto-saved to the active profile so refresh tokens
 * stay fresh.
 *
 * Writes directly to AuthStorage, so switched credentials take effect
 * immediately without restarting pi.
 */

import type { AuthStorageData, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, chmodSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

type Profiles = Record<string, AuthStorageData>;

const ADJECTIVES = [
	"amber", "blue", "coral", "crimson", "dusk",
	"ember", "frost", "golden", "jade", "lunar",
	"misty", "onyx", "pearl", "ruby", "sage",
	"silver", "teal", "velvet", "violet", "zinc",
];
const NOUNS = [
	"bear", "crane", "dove", "eagle", "falcon",
	"fox", "hawk", "heron", "lynx", "osprey",
	"otter", "owl", "puma", "raven", "seal",
	"sparrow", "swan", "tiger", "wolf", "wren",
];

export default function (pi: ExtensionAPI) {
	const agentDir = join(process.env.HOME!, ".pi", "agent");
	const authJsonPath = join(agentDir, "auth.json");
	const profilesPath = join(agentDir, "auth-profiles.json");
	const activePath = join(agentDir, "active-profile");

	let sessionCtx: ExtensionContext | undefined;
	let agentActive = false;
	let lastAppliedState: string | undefined;
	let fileWatcher: FSWatcher | undefined;

	// --- Random name generation ---

	function generateName(existing: Profiles): string {
		for (let i = 0; i < 100; i++) {
			const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
			const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
			const name = `${adj}-${noun}`;
			if (!(name in existing)) return name;
		}
		return `account-${Date.now()}`;
	}

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

	// --- Credential helpers ---

	function getAllCredentials(ctx: ExtensionContext): AuthStorageData {
		return ctx.modelRegistry.authStorage.getAll();
	}

	function applyCredentials(ctx: ExtensionContext, creds: AuthStorageData) {
		const auth = ctx.modelRegistry.authStorage;
		const currentProviders = new Set(auth.list());
		const newProviders = new Set(Object.keys(creds));

		for (const [provider, credential] of Object.entries(creds)) {
			auth.set(provider, credential);
		}

		for (const provider of currentProviders) {
			if (!newProviders.has(provider)) {
				auth.remove(provider);
			}
		}

		lastAppliedState = JSON.stringify(auth.getAll());
	}

	// --- File watcher ---

	function startWatcher() {
		if (!existsSync(authJsonPath)) return;
		try {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			fileWatcher = watch(authJsonPath, () => {
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(handleAuthFileChange, 300);
			});
		} catch {
			// fs.watch not available; fall back to manual management only
		}
	}

	function handleAuthFileChange() {
		if (!sessionCtx) return;

		const auth = sessionCtx.modelRegistry.authStorage;
		auth.reload();
		const current = auth.getAll();
		if (Object.keys(current).length === 0) return;

		const currentState = JSON.stringify(current);

		// Ignore our own writes
		if (currentState === lastAppliedState) return;

		const active = getActiveLabel();
		const profiles = loadProfiles();

		if (agentActive) {
			// Token refresh during API call: update active profile silently
			if (active && active in profiles) {
				profiles[active] = current;
				saveProfiles(profiles);
				lastAppliedState = currentState;
			}
			return;
		}

		// Agent is idle and credentials changed: likely a /login
		// Check if it matches the active profile (could be a late refresh write)
		if (active && active in profiles) {
			const savedState = JSON.stringify(profiles[active]);
			if (savedState === currentState) return;
		}

		// New credentials: save as a new profile
		const name = generateName(profiles);
		profiles[name] = current;
		saveProfiles(profiles);
		setActiveLabel(name);
		lastAppliedState = currentState;
		sessionCtx.ui.notify(
			`New login detected, saved as '${name}'. Use /account name to rename.`,
			"info",
		);
	}

	// --- Agent activity tracking ---

	pi.on("agent_start", async () => { agentActive = true; });
	pi.on("agent_end", async () => { agentActive = false; });

	// --- Session lifecycle ---

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;

		const profiles = loadProfiles();
		const current = getAllCredentials(ctx);

		// Auto-create first profile if credentials exist but no profiles saved
		if (Object.keys(profiles).length === 0 && Object.keys(current).length > 0) {
			const name = generateName(profiles);
			profiles[name] = current;
			saveProfiles(profiles);
			setActiveLabel(name);
			lastAppliedState = JSON.stringify(current);
			ctx.ui.notify(
				`Saved current credentials as '${name}'. Use /account name to rename.`,
				"info",
			);
		}

		// Apply active profile from disk
		const active = getActiveLabel();
		if (active) {
			const latest = loadProfiles();
			if (active in latest) {
				applyCredentials(ctx, latest[active]);
			}
		}

		startWatcher();
	});

	pi.on("session_shutdown", async () => {
		// Final autosave before exit
		if (sessionCtx) {
			const active = getActiveLabel();
			if (active) {
				const profiles = loadProfiles();
				if (active in profiles) {
					profiles[active] = getAllCredentials(sessionCtx);
					saveProfiles(profiles);
				}
			}
		}

		fileWatcher?.close();
		fileWatcher = undefined;
		sessionCtx = undefined;
	});

	// --- Commands ---

	pi.registerCommand("account", {
		description: "Switch account profile (or: /account name, /account rm)",
		getArgumentCompletions: (prefix: string) => {
			const subs = ["name", "rm"];
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

			if (sub === "name") {
				await handleName(parts[1], ctx);
			} else if (sub === "rm") {
				await handleRm(parts[1], ctx);
			} else if (sub) {
				await handleUse(sub, ctx);
			} else {
				await handleInteractiveSwitch(ctx);
			}
		},
	});

	async function handleInteractiveSwitch(ctx: ExtensionContext) {
		const profiles = loadProfiles();
		const labels = Object.keys(profiles);
		if (labels.length === 0) {
			ctx.ui.notify("No saved profiles. Use /login first.", "warning");
			return;
		}

		if (labels.length === 1) {
			ctx.ui.notify(`Only one profile ('${labels[0]}'). Use /login to add another account.`, "info");
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

	async function handleUse(label: string, ctx: ExtensionContext) {
		const profiles = loadProfiles();
		if (!(label in profiles)) {
			const available = Object.keys(profiles).join(", ") || "(none)";
			ctx.ui.notify(`No profile '${label}'. Available: ${available}`, "error");
			return;
		}

		// Autosave outgoing profile
		const active = getActiveLabel();
		if (active && active in profiles) {
			profiles[active] = getAllCredentials(ctx);
			saveProfiles(profiles);
		}

		// Apply new profile (re-read in case saveProfiles updated)
		const latest = loadProfiles();
		applyCredentials(ctx, latest[label]);

		setActiveLabel(label);
		ctx.ui.notify(`Switched to '${label}'.`, "success");
	}

	async function handleName(newName: string | undefined, ctx: ExtensionContext) {
		const active = getActiveLabel();
		if (!active) {
			ctx.ui.notify("No active profile to rename.", "warning");
			return;
		}

		let label = newName;
		if (!label) {
			label = (await ctx.ui.input(`Rename '${active}' to:`))?.trim();
		}
		if (!label) return;

		if (label === active) return;

		const profiles = loadProfiles();
		if (label in profiles) {
			ctx.ui.notify(`Profile '${label}' already exists.`, "error");
			return;
		}

		profiles[label] = profiles[active];
		delete profiles[active];
		saveProfiles(profiles);
		setActiveLabel(label);
		ctx.ui.notify(`Renamed '${active}' to '${label}'.`, "success");
	}

	async function handleRm(name: string | undefined, ctx: ExtensionContext) {
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
