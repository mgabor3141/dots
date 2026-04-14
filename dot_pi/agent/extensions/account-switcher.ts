/**
 * Account switcher for pi.
 *
 * Per provider, there is at most one active credential in auth.json. Inactive
 * credentials live in named slots in auth-profiles.json. A `current` marker
 * records what the active auth.json credential is called. It also serves as
 * the pending name for the next /login after a park-and-clear.
 *
 * This avoids sync logic entirely:
 * - auth.json is always the live credential pi uses and refreshes
 * - slots are only touched by explicit /account commands
 * - switching is implemented as an explicit swap
 *
 * Commands:
 *   /account                - interactive overview + actions
 *   /account status         - show active + saved state
 *   /account use [name]     - if [name] exists as a slot, swap to it
 *                             (parking the current credential under its name)
 *                             if [name] does not exist, park the current
 *                             credential and prepare for /login under [name]
 *   /account rm [name]      - delete an inactive saved slot
 *
 * Provider is inferred automatically. When multiple providers match, you are
 * prompted to choose via the TUI.
 *
 * Workflow:
 *   /login anthropic                   # credential A in auth.json (unnamed)
 *   /account use personal              # "personal" doesn't exist:
 *                                      #   prompts to name current -> "work"
 *                                      #   parks A as "work", clears auth.json
 *                                      #   next /login becomes "personal"
 *   /login anthropic                   # credential B in auth.json as "personal"
 *   /account use work                  # swaps: parks B as "personal", loads A
 *   /account use personal              # swaps: parks A as "work", loads B
 */

import type { AuthCredential, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface AccountStore {
	version: 3;
	slots: Record<string, Record<string, AuthCredential>>;
	current: Record<string, string>;
}

const SUBCOMMANDS = new Set(["use", "rm", "status"]);

export default function (pi: ExtensionAPI) {
	const agentDir = join(process.env.HOME!, ".pi", "agent");
	const storePath = join(agentDir, "auth-profiles.json");
	const legacyActivePath = join(agentDir, "active-profile");

	function emptyStore(): AccountStore {
		return { version: 3, slots: {}, current: {} };
	}

	function loadStore(): AccountStore {
		if (!existsSync(storePath)) return emptyStore();
		try {
			const raw = JSON.parse(readFileSync(storePath, "utf-8")) as Partial<AccountStore>;
			if (raw.version !== 3) return emptyStore();
			return {
				version: 3,
				slots: raw.slots ?? {},
				current: raw.current ?? {},
			};
		} catch {
			return emptyStore();
		}
	}

	function saveStore(store: AccountStore): void {
		writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
		chmodSync(storePath, 0o600);
	}

	function authProviders(ctx: ExtensionContext): string[] {
		return ctx.modelRegistry.authStorage.list();
	}

	function authGet(ctx: ExtensionContext, provider: string): AuthCredential | undefined {
		return ctx.modelRegistry.authStorage.get(provider);
	}

	function authSet(ctx: ExtensionContext, provider: string, credential: AuthCredential): void {
		ctx.modelRegistry.authStorage.set(provider, credential);
	}

	function authRemove(ctx: ExtensionContext, provider: string): void {
		ctx.modelRegistry.authStorage.remove(provider);
	}

	function getSavedProviders(store: AccountStore): string[] {
		return Object.keys(store.slots).filter((p) => Object.keys(store.slots[p] ?? {}).length > 0);
	}

	function getSlotNames(store: AccountStore, provider: string): string[] {
		return Object.keys(store.slots[provider] ?? {});
	}

	function getAllSlotEntries(store: AccountStore): Array<{ provider: string; name: string }> {
		const entries: Array<{ provider: string; name: string }> = [];
		for (const [provider, slots] of Object.entries(store.slots)) {
			for (const name of Object.keys(slots)) {
				entries.push({ provider, name });
			}
		}
		return entries;
	}

	function getAllSlotNames(store: AccountStore): string[] {
		const names = new Set<string>();
		for (const slots of Object.values(store.slots)) {
			for (const name of Object.keys(slots)) {
				names.add(name);
			}
		}
		return [...names];
	}

	function providersWithSlot(store: AccountStore, name: string): string[] {
		return Object.keys(store.slots).filter((p) => name in (store.slots[p] ?? {}));
	}

	function cleanupProvider(store: AccountStore, provider: string): void {
		if (store.slots[provider] && Object.keys(store.slots[provider]).length === 0) {
			delete store.slots[provider];
		}
	}

	function sanitizeStore(store: AccountStore): boolean {
		let changed = false;
		for (const provider of Object.keys(store.slots)) {
			if (Object.keys(store.slots[provider] ?? {}).length === 0) {
				delete store.slots[provider];
				changed = true;
			}
		}
		for (const [provider, currentName] of Object.entries(store.current)) {
			// Remove empty markers or markers that conflict with a saved slot
			if (!currentName || store.slots[provider]?.[currentName]) {
				delete store.current[provider];
				changed = true;
			}
		}
		return changed;
	}

	function loadCanonicalStore(ctx: ExtensionContext): AccountStore {
		ctx.modelRegistry.authStorage.reload();
		const store = loadStore();
		if (sanitizeStore(store)) {
			saveStore(store);
		}
		return store;
	}

	function getCurrentName(store: AccountStore, provider: string): string | undefined {
		const name = store.current[provider];
		return name && name.length > 0 ? name : undefined;
	}

	async function promptForSlotName(ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
		const name = (await ctx.ui.input(prompt))?.trim();
		return name && name.length > 0 ? name : undefined;
	}

	function buildStatusLines(store: AccountStore, ctx: ExtensionContext): string[] {
		ctx.modelRegistry.authStorage.reload();
		const loggedIn = authProviders(ctx);
		const lines: string[] = [];

		lines.push("Active:");
		if (loggedIn.length > 0) {
			for (const provider of loggedIn) {
				const currentName = getCurrentName(store, provider);
				lines.push(`  ${provider}: ${currentName ?? "(unnamed)"}`);
			}
		} else {
			lines.push("  (none)");
		}

		for (const [provider, name] of Object.entries(store.current)) {
			if (!loggedIn.includes(provider) && name) {
				lines.push(`  ${provider}: awaiting /login as '${name}'`);
			}
		}

		const savedProviders = getSavedProviders(store);
		if (savedProviders.length > 0) {
			lines.push("", "Saved:");
			for (const provider of savedProviders) {
				for (const name of getSlotNames(store, provider)) {
					lines.push(`  ${provider}/${name}`);
				}
			}
		}

		return lines;
	}

	function handleStatus(ctx: ExtensionContext): void {
		const store = loadCanonicalStore(ctx);
		ctx.ui.notify(buildStatusLines(store, ctx).join("\n"), "info");
	}

	async function handleUse(nameArg: string | undefined, ctx: ExtensionContext): Promise<void> {
		const store = loadCanonicalStore(ctx);
		const activeProviders = authProviders(ctx);

		let name = nameArg;
		if (!name) {
			const slotNames = getAllSlotNames(store);
			if (slotNames.length > 0) {
				const newOption = "(new name)";
				const options = [...slotNames, newOption];
				const choice = await ctx.ui.select("Switch to:", options);
				if (!choice) return;
				if (choice === newOption) {
					name = await promptForSlotName(ctx, "New account name:");
				} else {
					name = choice;
				}
			} else {
				name = await promptForSlotName(ctx, "New account name:");
			}
		}
		if (!name) return;

		// Resolve provider
		const slotProvs = providersWithSlot(store, name);
		let provider: string | undefined;

		if (slotProvs.length > 0) {
			provider = slotProvs.length === 1
				? slotProvs[0]
				: await ctx.ui.select(`'${name}' exists for multiple providers:`, slotProvs);
		} else {
			if (activeProviders.length === 0) {
				ctx.ui.notify("No credentials configured. Use /login first.", "warning");
				return;
			}
			provider = activeProviders.length === 1
				? activeProviders[0]
				: await ctx.ui.select("Save which provider's credential?", activeProviders);
		}
		if (!provider) return;

		const activeCredential = authGet(ctx, provider);
		const hasActive = activeCredential !== undefined;
		const targetCredential = store.slots[provider]?.[name];

		// Case 1: Slot exists, swap to it
		if (targetCredential) {
			if (hasActive) {
				const currentName = getCurrentName(store, provider);
				if (currentName === name) {
					ctx.ui.notify(`'${name}' is already the active ${provider} account.`, "info");
					return;
				}

				let parkName = currentName;
				if (!parkName) {
					parkName = await promptForSlotName(
						ctx,
						`Name the current ${provider} credential before switching to '${name}':`,
					);
					if (!parkName) return;
				}

				if (parkName === name) {
					ctx.ui.notify(`'${name}' is already the active ${provider} account.`, "info");
					return;
				}

				if (store.slots[provider]?.[parkName]) {
					ctx.ui.notify(
						`Cannot switch: saved slot '${provider}/${parkName}' already exists. Remove it first.`,
						"error",
					);
					return;
				}

				if (!store.slots[provider]) store.slots[provider] = {};
				store.slots[provider][parkName] = activeCredential;
			}

			authSet(ctx, provider, targetCredential);
			delete store.slots[provider][name];
			store.current[provider] = name;
			cleanupProvider(store, provider);
			saveStore(store);
			ctx.ui.notify(`Switched ${provider} to '${name}'.`, "info");
			return;
		}

		// Case 2: Slot doesn't exist, park current and prepare for new login
		if (!hasActive) {
			ctx.ui.notify(`No active ${provider} credential to save.`, "error");
			return;
		}

		const currentName = getCurrentName(store, provider);
		if (currentName === name) {
			ctx.ui.notify(`'${name}' is already the active ${provider} account.`, "info");
			return;
		}

		let parkName = currentName;
		if (!parkName) {
			parkName = await promptForSlotName(
				ctx,
				`Name the current ${provider} credential before switching to '${name}':`,
			);
			if (!parkName) return;
		}

		if (parkName === name) {
			// User named the current credential the same as the target.
			// That just means "this IS that account", so label it and stop.
			store.current[provider] = name;
			saveStore(store);
			ctx.ui.notify(`Named current ${provider} credential '${name}'.`, "info");
			return;
		}

		if (store.slots[provider]?.[parkName]) {
			ctx.ui.notify(
				`Cannot save: slot '${provider}/${parkName}' already exists. Remove it first.`,
				"error",
			);
			return;
		}

		if (!store.slots[provider]) store.slots[provider] = {};
		store.slots[provider][parkName] = activeCredential;
		authRemove(ctx, provider);
		store.current[provider] = name;
		cleanupProvider(store, provider);
		saveStore(store);
		ctx.ui.notify(
			`Saved ${provider} as '${parkName}'. Run /login ${provider} to set up '${name}'.`,
			"info",
		);
	}

	async function handleRm(nameArg: string | undefined, ctx: ExtensionContext): Promise<void> {
		const store = loadCanonicalStore(ctx);
		const entries = getAllSlotEntries(store);

		if (entries.length === 0) {
			ctx.ui.notify("No saved slots to remove.", "warning");
			return;
		}

		let name = nameArg;
		let provider: string | undefined;

		if (!name) {
			const options = entries.map((e) => `${e.name} (${e.provider})`);
			const choice = entries.length === 1
				? options[0]
				: await ctx.ui.select("Remove which slot?", options);
			if (!choice) return;
			const selected = entries[options.indexOf(choice)];
			name = selected.name;
			provider = selected.provider;
		}

		if (!provider) {
			const slotProvs = providersWithSlot(store, name);
			if (slotProvs.length === 0) {
				ctx.ui.notify(`No slot named '${name}'.`, "error");
				return;
			}
			provider = slotProvs.length === 1
				? slotProvs[0]
				: await ctx.ui.select(`'${name}' exists for multiple providers:`, slotProvs);
		}
		if (!provider) return;

		if (!store.slots[provider]?.[name]) {
			ctx.ui.notify(`No slot '${provider}/${name}'.`, "error");
			return;
		}

		const ok = await ctx.ui.confirm(
			"Remove slot",
			`Delete '${provider}/${name}'? This cannot be undone.`,
		);
		if (!ok) return;

		delete store.slots[provider][name];
		cleanupProvider(store, provider);
		saveStore(store);
		ctx.ui.notify(`Removed '${provider}/${name}'.`, "info");
	}

	async function handleInteractive(ctx: ExtensionContext): Promise<void> {
		const store = loadCanonicalStore(ctx);
		const statusLines = buildStatusLines(store, ctx);
		const activeProviders = authProviders(ctx);
		const savedProviders = getSavedProviders(store);

		if (activeProviders.length === 0 && savedProviders.length === 0) {
			ctx.ui.notify("No credentials configured. Use /login to add one.", "info");
			return;
		}

		const options: string[] = [];
		const handlers: Array<() => Promise<void>> = [];

		// Switch to saved slots
		for (const provider of savedProviders) {
			for (const name of getSlotNames(store, provider)) {
				options.push(`Switch to ${name} (${provider})`);
				handlers.push(() => handleUse(name, ctx));
			}
		}

		// Save current and set up new account
		for (const provider of activeProviders) {
			const currentName = getCurrentName(store, provider);
			options.push(`Save ${currentName ?? provider} and set up new account`);
			handlers.push(async () => {
				const newName = await promptForSlotName(ctx, `New account name for ${provider}:`);
				if (newName) await handleUse(newName, ctx);
			});
		}

		if (options.length === 0) {
			ctx.ui.notify(statusLines.join("\n"), "info");
			return;
		}

		const choice = await ctx.ui.select(statusLines.join("\n") + "\n", options);
		if (choice === undefined) return;
		await handlers[options.indexOf(choice)]();
	}

	pi.on("session_start", async (_event, ctx) => {
		if (existsSync(legacyActivePath)) {
			try { unlinkSync(legacyActivePath); } catch { /* ignore */ }
		}
		ctx.modelRegistry.authStorage.reload();
		const store = loadStore();
		if (sanitizeStore(store)) {
			saveStore(store);
		}
	});

	pi.registerCommand("account", {
		description: "Manage account credentials (/account use, rm, status)",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.split(/\s+/);
			const store = loadStore();

			if (parts.length <= 1) {
				const input = parts[0] ?? "";
				return [...SUBCOMMANDS]
					.filter((sub) => sub.startsWith(input))
					.map((sub) => ({ value: sub, label: sub }));
			}

			const sub = parts[0];
			const input = parts[parts.length - 1];

			if (parts.length === 2 && (sub === "use" || sub === "rm")) {
				return getAllSlotNames(store)
					.filter((name) => name.startsWith(input))
					.map((name) => ({ value: name, label: name }));
			}

			return null;
		},
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const sub = parts[0];
			if (sub === "status") {
				handleStatus(ctx);
				return;
			}
			if (sub === "use") {
				await handleUse(parts[1], ctx);
				return;
			}
			if (sub === "rm") {
				await handleRm(parts[1], ctx);
				return;
			}
			if (sub) {
				ctx.ui.notify(`Unknown subcommand '${sub}'. Use: use, rm, status.`, "error");
				return;
			}
			await handleInteractive(ctx);
		},
	});
}
