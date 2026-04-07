/**
 * Account switcher for pi.
 *
 * Manages per-provider credential slots so you can switch between accounts
 * (e.g., personal vs work Anthropic) without affecting other providers.
 *
 * A "slot" is a named credential for a specific provider (e.g., anthropic/work).
 * Switching by slot name operates across all providers that have a slot with
 * that name, so consistently naming slots "work" and "personal" gives you
 * profile-like behavior without explicit profile management.
 *
 * Commands:
 *   /account                   - interactive: view state and switch
 *   /account <slot>            - switch all providers that have this slot to it
 *   /account <provider> <slot> - switch a single provider to a specific slot
 *   /account save [prov] [name] - save a provider's current credential as a named slot
 *   /account rm                - remove a slot
 *   /account status            - show all slots and active selections
 *
 * No file watcher or auto-detection. Credentials are saved explicitly.
 * Token refreshes are captured automatically on switch and session shutdown
 * by syncing auth.json back into the active slots.
 *
 * Writes directly to AuthStorage, so switched credentials take effect
 * immediately without restarting pi.
 */

import type { AuthStorageData, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Single credential (OAuth or API key). Extracted from AuthStorageData. */
type AuthCredential = AuthStorageData[string];

interface AccountStore {
	version: 2;
	/** Per-provider credential slots: provider -> { slotName -> credential } */
	slots: Record<string, Record<string, AuthCredential>>;
	/** Currently active slot name for each provider */
	active: Record<string, string>;
}

const SUBCOMMANDS = new Set(["save", "rm", "status"]);

export default function (pi: ExtensionAPI) {
	const agentDir = join(process.env.HOME!, ".pi", "agent");
	const storePath = join(agentDir, "auth-profiles.json");
	const legacyActivePath = join(agentDir, "active-profile");

	let sessionCtx: ExtensionContext | undefined;

	// ── Storage ──────────────────────────────────────────────────────────

	function emptyStore(): AccountStore {
		return { version: 2, slots: {}, active: {} };
	}

	function loadStore(): AccountStore {
		if (!existsSync(storePath)) return emptyStore();
		try {
			const raw = JSON.parse(readFileSync(storePath, "utf-8"));
			if (raw.version === 2) return raw as AccountStore;
			// Old format (pre-v2): discard; old data was mostly duplicates
			return emptyStore();
		} catch {
			return emptyStore();
		}
	}

	function saveStore(store: AccountStore) {
		writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
		chmodSync(storePath, 0o600);
	}

	// ── Credential helpers ───────────────────────────────────────────────

	function getCurrentCredentials(ctx: ExtensionContext): AuthStorageData {
		return ctx.modelRegistry.authStorage.getAll();
	}

	function getProviderList(ctx: ExtensionContext): string[] {
		return ctx.modelRegistry.authStorage.list();
	}

	/**
	 * Sync current auth.json credentials back into their active slots.
	 * This captures token refreshes that happened since last sync.
	 * Only updates providers that already have an active slot in the store.
	 */
	function syncActiveSlots(store: AccountStore, ctx: ExtensionContext): void {
		const current = getCurrentCredentials(ctx);
		for (const [provider, credential] of Object.entries(current)) {
			const activeSlot = store.active[provider];
			if (activeSlot && store.slots[provider]?.[activeSlot]) {
				store.slots[provider][activeSlot] = credential;
			}
		}
	}

	/**
	 * Apply credentials from active slots to AuthStorage.
	 * If onlyProviders is specified, only those providers are touched.
	 */
	function applyActiveSlots(
		store: AccountStore,
		ctx: ExtensionContext,
		onlyProviders?: Set<string>,
	) {
		const auth = ctx.modelRegistry.authStorage;
		for (const [provider, slotName] of Object.entries(store.active)) {
			if (onlyProviders && !onlyProviders.has(provider)) continue;
			const credential = store.slots[provider]?.[slotName];
			if (credential) {
				auth.set(provider, credential);
			}
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;

		// Clean up legacy files from v1
		if (existsSync(legacyActivePath)) {
			try { unlinkSync(legacyActivePath); } catch { /* ignore */ }
		}

		// Apply active slots on startup (restores last-used credentials)
		const store = loadStore();
		if (Object.keys(store.active).length > 0) {
			applyActiveSlots(store, ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		if (sessionCtx) {
			const store = loadStore();
			if (Object.keys(store.active).length > 0) {
				syncActiveSlots(store, sessionCtx);
				saveStore(store);
			}
		}
		sessionCtx = undefined;
	});

	// ── Command registration ─────────────────────────────────────────────

	pi.registerCommand("account", {
		description: "Switch accounts (/account save, rm, status)",
		getArgumentCompletions: (prefix: string) => {
			const store = loadStore();
			// Collect all unique slot names + subcommands
			const slotNames = new Set<string>();
			for (const slots of Object.values(store.slots)) {
				for (const name of Object.keys(slots)) {
					slotNames.add(name);
				}
			}
			const all = [...SUBCOMMANDS, ...slotNames];
			const filtered = all
				.filter((s) => s.startsWith(prefix))
				.map((s) => ({ value: s, label: s }));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const sub = parts[0];

			if (sub === "status") {
				handleStatus(ctx);
			} else if (sub === "save") {
				await handleSave(parts[1], parts[2], ctx);
			} else if (sub === "rm") {
				await handleRm(ctx);
			} else if (parts.length === 2) {
				// /account <provider> <slot>
				await switchProvider(parts[0], parts[1], ctx);
			} else if (sub) {
				// /account <slot> (cross-provider switch)
				await handleSwitchBySlotName(sub, ctx);
			} else {
				await handleInteractive(ctx);
			}
		},
	});

	// ── Status helpers ───────────────────────────────────────────────────

	/**
	 * Build a status summary showing each provider's state:
	 * - Logged-in providers with saved slots show slot names (active marked *)
	 * - Logged-in providers without saved slots are flagged as unsaved
	 * - Saved providers not currently in auth.json are noted
	 */
	function buildStatusLines(store: AccountStore, ctx: ExtensionContext): string[] {
		const loggedIn = new Set(getProviderList(ctx));
		const allProviders = new Set([...loggedIn, ...Object.keys(store.slots)]);
		const lines: string[] = [];

		for (const provider of allProviders) {
			const slots = store.slots[provider];
			const hasSlots = slots && Object.keys(slots).length > 0;
			const isLoggedIn = loggedIn.has(provider);
			const active = store.active[provider];

			if (hasSlots) {
				const slotDisplay = Object.keys(slots)
					.map((s) => (s === active ? `${s}*` : s))
					.join(" | ");
				const suffix = isLoggedIn ? "" : " (not logged in)";
				lines.push(`  ${provider}: ${slotDisplay}${suffix}`);
			} else if (isLoggedIn) {
				lines.push(`  ${provider}: logged in (not saved)`);
			}
		}

		return lines;
	}

	// ── /account status ──────────────────────────────────────────────────

	function handleStatus(ctx: ExtensionContext) {
		const store = loadStore();
		const lines = buildStatusLines(store, ctx);

		if (lines.length === 0) {
			ctx.ui.notify(
				"No credentials found. Use /login, then /account save.",
				"info",
			);
			return;
		}

		ctx.ui.notify(lines.join("\n"), "info");
	}

	// ── /account save [provider] [name] ──────────────────────────────────

	async function handleSave(
		providerArg: string | undefined,
		nameArg: string | undefined,
		ctx: ExtensionContext,
	) {
		const providers = getProviderList(ctx);
		if (providers.length === 0) {
			ctx.ui.notify("No credentials in auth.json. Use /login first.", "warning");
			return;
		}

		let provider = providerArg;
		if (!provider) {
			if (providers.length === 1) {
				provider = providers[0];
			} else {
				provider = await ctx.ui.select(
					"Save credential for which provider?",
					providers,
				);
			}
		}
		if (!provider) return;

		if (!providers.includes(provider)) {
			ctx.ui.notify(`No credential for '${provider}' in auth.json.`, "error");
			return;
		}

		let name = nameArg;
		if (!name) {
			name = (await ctx.ui.input(`Name for this ${provider} credential:`))?.trim();
		}
		if (!name) return;

		const store = loadStore();
		const current = getCurrentCredentials(ctx);
		const credential = current[provider];
		if (!credential) {
			ctx.ui.notify(`No credential for '${provider}'.`, "error");
			return;
		}

		// Confirm overwrite if slot exists
		if (store.slots[provider]?.[name]) {
			const ok = await ctx.ui.confirm(
				"Overwrite",
				`Slot '${provider}/${name}' already exists. Overwrite?`,
			);
			if (!ok) return;
		}

		if (!store.slots[provider]) store.slots[provider] = {};
		store.slots[provider][name] = credential;
		store.active[provider] = name;
		saveStore(store);

		ctx.ui.notify(`Saved ${provider} credential as '${name}'.`, "info");
	}

	// ── /account <slot> (cross-provider switch) ──────────────────────────

	async function handleSwitchBySlotName(slotName: string, ctx: ExtensionContext) {
		const store = loadStore();

		// Find all providers that have a slot with this name
		const matchingProviders: string[] = [];
		for (const [provider, slots] of Object.entries(store.slots)) {
			if (slotName in slots) {
				matchingProviders.push(provider);
			}
		}

		if (matchingProviders.length === 0) {
			ctx.ui.notify(`No providers have a slot named '${slotName}'.`, "error");
			return;
		}

		// Sync token refreshes before switching
		syncActiveSlots(store, ctx);

		// Switch only providers where the active slot actually differs
		const changedProviders = new Set<string>();
		for (const provider of matchingProviders) {
			if (store.active[provider] !== slotName) {
				store.active[provider] = slotName;
				changedProviders.add(provider);
			}
		}

		if (changedProviders.size === 0) {
			saveStore(store);
			ctx.ui.notify(`Already on '${slotName}'.`, "info");
			return;
		}

		applyActiveSlots(store, ctx, changedProviders);
		saveStore(store);

		const changed = [...changedProviders].join(", ");
		ctx.ui.notify(`Switched to '${slotName}' (${changed}).`, "info");
	}

	// ── /account <provider> <slot> ───────────────────────────────────────

	async function switchProvider(
		provider: string,
		slot: string,
		ctx: ExtensionContext,
	) {
		const store = loadStore();
		if (!store.slots[provider]?.[slot]) {
			ctx.ui.notify(`No slot '${provider}/${slot}'.`, "error");
			return;
		}

		if (store.active[provider] === slot) {
			ctx.ui.notify(`${provider} is already on '${slot}'.`, "info");
			return;
		}

		syncActiveSlots(store, ctx);
		store.active[provider] = slot;
		applyActiveSlots(store, ctx, new Set([provider]));
		saveStore(store);

		ctx.ui.notify(`Switched ${provider} to '${slot}'.`, "info");
	}

	// ── /account rm ──────────────────────────────────────────────────────

	async function handleRm(ctx: ExtensionContext) {
		const store = loadStore();

		const options: string[] = [];
		const items: Array<{ provider: string; slot: string }> = [];

		for (const [provider, slots] of Object.entries(store.slots)) {
			for (const slot of Object.keys(slots)) {
				const isActive = store.active[provider] === slot;
				options.push(`${provider}/${slot}${isActive ? " (active)" : ""}`);
				items.push({ provider, slot });
			}
		}

		if (options.length === 0) {
			ctx.ui.notify("Nothing to remove.", "warning");
			return;
		}

		const choice = await ctx.ui.select("Remove slot:", options);
		if (choice === undefined) return;

		const { provider, slot } = items[options.indexOf(choice)];
		const isActive = store.active[provider] === slot;
		const remaining = Object.keys(store.slots[provider]).filter((s) => s !== slot);

		if (isActive) {
			const msg = remaining.length === 0
				? `'${provider}/${slot}' is the only slot for this provider. Remove?`
				: `'${provider}/${slot}' is active. Will switch to '${remaining[0]}'. Remove?`;
			const ok = await ctx.ui.confirm("Remove active slot", msg);
			if (!ok) return;
		} else {
			const ok = await ctx.ui.confirm("Remove slot", `Delete '${provider}/${slot}'?`);
			if (!ok) return;
		}

		delete store.slots[provider][slot];

		if (Object.keys(store.slots[provider]).length === 0) {
			delete store.slots[provider];
			delete store.active[provider];
		} else if (isActive) {
			store.active[provider] = remaining[0];
			applyActiveSlots(store, ctx, new Set([provider]));
		}

		saveStore(store);
		ctx.ui.notify(`Removed '${provider}/${slot}'.`, "info");
	}

	// ── /account (interactive) ───────────────────────────────────────────

	async function handleInteractive(ctx: ExtensionContext) {
		const store = loadStore();
		const statusLines = buildStatusLines(store, ctx);

		if (statusLines.length === 0) {
			ctx.ui.notify(
				"No accounts configured. Use /login, then /account save.",
				"info",
			);
			return;
		}

		// Build switch options for providers with multiple slots
		const options: string[] = [];
		const actions: Array<{ provider: string; slot: string }> = [];

		for (const [provider, slots] of Object.entries(store.slots)) {
			const slotNames = Object.keys(slots);
			if (slotNames.length <= 1) continue;
			const active = store.active[provider];
			for (const slot of slotNames) {
				if (slot === active) continue;
				options.push(`${provider} → ${slot}`);
				actions.push({ provider, slot });
			}
		}

		if (options.length === 0) {
			// No switching possible; just show status
			ctx.ui.notify(statusLines.join("\n"), "info");
			return;
		}

		const title = statusLines.join("\n") + "\n\nSwitch to:";
		const choice = await ctx.ui.select(title, options);
		if (choice === undefined) return;

		const { provider, slot } = actions[options.indexOf(choice)];
		await switchProvider(provider, slot, ctx);
	}
}
