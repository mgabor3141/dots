/**
 * Account switcher for pi.
 *
 * Per provider, there is at most one active credential in auth.json. Inactive
 * credentials live in named slots in auth-profiles.json. A small `current`
 * marker records what the active auth.json credential is called, if known.
 *
 * This avoids sync logic entirely:
 * - auth.json is always the live credential pi uses and refreshes
 * - slots are only touched by explicit /account commands
 * - switching is implemented as an explicit swap
 *
 * Commands:
 *   /account                          - interactive overview + actions
 *   /account status                   - show active + saved state
 *   /account name [prov] [name]       - label the active auth.json credential
 *                                       for a provider without moving it
 *   /account use [prov] [name]        - if [name] exists, swap to it
 *                                       if [name] does not exist, park the
 *                                       current active auth under that name
 *                                       and clear auth.json for that provider
 *   /account rm [prov] [name]         - delete an inactive saved slot
 *
 * Examples:
 *   /login anthropic
 *   /account name anthropic work
 *   /account use anthropic work        # parks current active auth as 'work'
 *   /login anthropic
 *   /account name anthropic personal
 *   /account use anthropic work        # swaps personal <-> work
 *   /account use anthropic personal    # swaps work <-> personal
 *
 * Important:
 *   Built-in /login overwrites the active auth in auth.json. That is the
 *   intended way to replace the current account. After /login, use /account
 *   name to relabel the new active auth, or /account use <provider> <new-name>
 *   to park it under a new slot name.
 */

import type { AuthCredential, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface AccountStore {
	version: 3;
	slots: Record<string, Record<string, AuthCredential>>;
	current: Record<string, string>;
}

const SUBCOMMANDS = new Set(["name", "use", "rm", "status"]);

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

	function authHas(ctx: ExtensionContext, provider: string): boolean {
		return ctx.modelRegistry.authStorage.has(provider);
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
		return Object.keys(store.slots).filter((provider) => Object.keys(store.slots[provider] ?? {}).length > 0);
	}

	function getKnownProviders(store: AccountStore): string[] {
		return [...new Set([...Object.keys(store.current), ...getSavedProviders(store)])];
	}

	function getSlotNames(store: AccountStore, provider: string): string[] {
		return Object.keys(store.slots[provider] ?? {});
	}

	function cleanupProvider(store: AccountStore, provider: string): void {
		if (store.slots[provider] && Object.keys(store.slots[provider]).length === 0) {
			delete store.slots[provider];
		}
		if (!(provider in store.current)) return;
		if (store.current[provider] === "") {
			delete store.current[provider];
		}
	}

	function sanitizeStore(store: AccountStore, activeProviders: ReadonlySet<string>): boolean {
		let changed = false;
		for (const provider of Object.keys(store.slots)) {
			if (Object.keys(store.slots[provider] ?? {}).length === 0) {
				delete store.slots[provider];
				changed = true;
			}
		}
		for (const [provider, currentName] of Object.entries(store.current)) {
			if (!activeProviders.has(provider) || store.slots[provider]?.[currentName]) {
				delete store.current[provider];
				changed = true;
			}
		}
		return changed;
	}

	function loadCanonicalStore(ctx: ExtensionContext): AccountStore {
		ctx.modelRegistry.authStorage.reload();
		const store = loadStore();
		const activeProviders = new Set(authProviders(ctx));
		if (sanitizeStore(store, activeProviders)) {
			saveStore(store);
		}
		return store;
	}

	function getCurrentName(store: AccountStore, provider: string): string | undefined {
		const name = store.current[provider];
		return name && name.length > 0 ? name : undefined;
	}

	async function chooseActiveProvider(ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
		ctx.modelRegistry.authStorage.reload();
		const providers = authProviders(ctx);
		if (providers.length === 0) return undefined;
		if (providers.length === 1) return providers[0];
		return await ctx.ui.select(prompt, providers);
	}

	async function chooseSavedProvider(store: AccountStore, ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
		const providers = getSavedProviders(store);
		if (providers.length === 0) return undefined;
		if (providers.length === 1) return providers[0];
		return await ctx.ui.select(prompt, providers);
	}

	async function promptForSlotName(ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
		const name = (await ctx.ui.input(prompt))?.trim();
		return name && name.length > 0 ? name : undefined;
	}

	async function resolveCurrentNameForSwap(
		store: AccountStore,
		provider: string,
		ctx: ExtensionContext,
		targetName: string,
	): Promise<string | undefined> {
		const currentName = getCurrentName(store, provider);
		if (currentName) return currentName;
		return await promptForSlotName(
			ctx,
			`Current ${provider} auth is unnamed. Name it before switching to '${targetName}':`,
		);
	}

	function buildStatusLines(store: AccountStore, ctx: ExtensionContext): string[] {
		ctx.modelRegistry.authStorage.reload();
		const loggedIn = authProviders(ctx);
		const lines: string[] = [];

		if (loggedIn.length > 0) {
			lines.push("Active (auth.json):");
			for (const provider of loggedIn) {
				const currentName = getCurrentName(store, provider);
				lines.push(`  ${provider} -> ${currentName ?? "(unnamed)"}`);
			}
		} else {
			lines.push("Active (auth.json): (none)");
		}

		const savedProviders = getSavedProviders(store);
		if (savedProviders.length > 0) {
			lines.push("", "Saved slots:");
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

	async function handleName(
		providerArg: string | undefined,
		nameArg: string | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		ctx.modelRegistry.authStorage.reload();
		const loggedIn = authProviders(ctx);
		if (loggedIn.length === 0) {
			ctx.ui.notify("No credentials in auth.json to label.", "warning");
			return;
		}

		let provider = providerArg;
		if (!provider) {
			provider = await chooseActiveProvider(ctx, "Name which active provider?");
		}
		if (!provider) return;

		if (!authHas(ctx, provider)) {
			ctx.ui.notify(`No active credential for '${provider}'.`, "error");
			return;
		}

		let name = nameArg;
		if (!name) {
			name = await promptForSlotName(ctx, `Name for current ${provider} auth:`);
		}
		if (!name) return;

		const store = loadCanonicalStore(ctx);
		const existingSlot = store.slots[provider]?.[name];
		const currentName = getCurrentName(store, provider);
		if (existingSlot && currentName !== name) {
			ctx.ui.notify(
				`Slot '${provider}/${name}' already exists as an inactive saved account. Use '/account use ${provider} ${name}' to switch to it, or remove it first.`,
				"error",
			);
			return;
		}

		store.current[provider] = name;
		saveStore(store);
		ctx.ui.notify(`Current ${provider} auth is now labeled '${name}'.`, "info");
	}

	async function handleUse(
		providerArg: string | undefined,
		nameArg: string | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		const store = loadCanonicalStore(ctx);

		let provider = providerArg;
		if (!provider) {
			const activeProviders = authProviders(ctx);
			const savedProviders = getSavedProviders(store);
			const providers = [...new Set([...activeProviders, ...savedProviders])];
			if (providers.length === 0) {
				ctx.ui.notify("No credentials configured. Use /login first.", "warning");
				return;
			}
			provider = providers.length === 1 ? providers[0] : await ctx.ui.select("Use which provider?", providers);
		}
		if (!provider) return;

		let name = nameArg;
		if (!name) {
			const slotNames = getSlotNames(store, provider);
			name = slotNames.length === 1
				? slotNames[0]
				: await promptForSlotName(ctx, `Slot name to use for ${provider}:`);
		}
		if (!name) return;

		const activeCredential = authGet(ctx, provider);
		const hasActive = activeCredential !== undefined;
		const targetCredential = store.slots[provider]?.[name];

		// Existing slot: activate it, swapping current active auth out if needed.
		if (targetCredential) {
			if (hasActive) {
				const currentName = await resolveCurrentNameForSwap(store, provider, ctx, name);
				if (!currentName) return;
				if (currentName === name) {
					ctx.ui.notify(`'${provider}/${name}' is already the active account.`, "info");
					return;
				}
				if (store.slots[provider]?.[currentName]) {
					ctx.ui.notify(
						`Cannot switch because '${provider}/${currentName}' already exists as a saved slot. Rename or remove it first.`,
						"error",
					);
					return;
				}

				if (!store.slots[provider]) store.slots[provider] = {};
				store.slots[provider][currentName] = activeCredential;
				authSet(ctx, provider, targetCredential);
				delete store.slots[provider][name];
				store.current[provider] = name;
				cleanupProvider(store, provider);
				saveStore(store);
				ctx.ui.notify(`Switched ${provider} from '${currentName}' to '${name}'.`, "info");
				return;
			}

			authSet(ctx, provider, targetCredential);
			delete store.slots[provider][name];
			store.current[provider] = name;
			cleanupProvider(store, provider);
			saveStore(store);
			ctx.ui.notify(`Loaded ${provider}/${name} into auth.json.`, "info");
			return;
		}

		// Missing slot name: park current active auth under this new name.
		if (!hasActive) {
			ctx.ui.notify(`No active '${provider}' auth to store as '${name}'.`, "error");
			return;
		}

		if (store.slots[provider]?.[name]) {
			ctx.ui.notify(`Slot '${provider}/${name}' already exists.`, "error");
			return;
		}

		if (!store.slots[provider]) store.slots[provider] = {};
		store.slots[provider][name] = activeCredential;
		authRemove(ctx, provider);
		delete store.current[provider];
		cleanupProvider(store, provider);
		saveStore(store);
		ctx.ui.notify(
			`Stored current ${provider} auth as '${name}' and cleared auth.json for that provider. You can now /login ${provider} safely.`,
			"info",
		);
	}

	async function handleRm(
		providerArg: string | undefined,
		nameArg: string | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		const store = loadCanonicalStore(ctx);
		const items: Array<{ provider: string; name: string }> = [];
		const options: string[] = [];
		for (const [provider, slots] of Object.entries(store.slots)) {
			for (const name of Object.keys(slots)) {
				items.push({ provider, name });
				options.push(`${provider}/${name}`);
			}
		}

		if (items.length === 0) {
			ctx.ui.notify("No saved slots to remove.", "warning");
			return;
		}

		let provider = providerArg;
		let name = nameArg;
		if (!provider) {
			provider = await chooseSavedProvider(store, ctx, "Remove from which provider?");
		}
		if (!provider) return;
		if (!name) {
			const slotNames = getSlotNames(store, provider);
			if (slotNames.length === 0) {
				ctx.ui.notify(`No saved slots for '${provider}'.`, "error");
				return;
			}
			name = slotNames.length === 1 ? slotNames[0] : await ctx.ui.select(`Remove which ${provider} slot?`, slotNames);
		}
		if (!name) return;

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

		type Action =
			| { kind: "name"; provider: string }
			| { kind: "use"; provider: string; name: string };

		const options: string[] = [];
		const actions: Action[] = [];

		for (const provider of activeProviders) {
			const currentName = getCurrentName(store, provider);
			options.push(`Name ${provider}${currentName ? ` as ${currentName}` : ""}`);
			actions.push({ kind: "name", provider });
		}

		for (const [provider, slots] of Object.entries(store.slots)) {
			for (const name of Object.keys(slots)) {
				options.push(`Use ${provider}/${name}`);
				actions.push({ kind: "use", provider, name });
			}
		}

		if (activeProviders.length > 0) {
			for (const provider of activeProviders) {
				options.push(`Use ${provider}/<new name>  (store current and clear active auth)`);
				actions.push({ kind: "use", provider, name: "" });
			}
		}

		const choice = await ctx.ui.select(statusLines.join("\n") + "\n", options);
		if (choice === undefined) return;
		const action = actions[options.indexOf(choice)];
		if (action.kind === "name") {
			await handleName(action.provider, undefined, ctx);
			return;
		}
		if (action.name) {
			await handleUse(action.provider, action.name, ctx);
			return;
		}
		const newName = await promptForSlotName(ctx, `New name for current ${action.provider} auth:`);
		if (!newName) return;
		await handleUse(action.provider, newName, ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (existsSync(legacyActivePath)) {
			try { unlinkSync(legacyActivePath); } catch { /* ignore */ }
		}
		ctx.modelRegistry.authStorage.reload();
		const store = loadStore();
		const activeProviders = new Set(authProviders(ctx));
		sanitizeStore(store, activeProviders);
		saveStore(store);
	});

	pi.registerCommand("account", {
		description: "Manage account credentials (/account name, use, rm, status)",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.split(/\s+/);
			const store = loadStore();

			if (parts.length <= 1) {
				const input = parts[0] ?? "";
				return [...SUBCOMMANDS]
					.filter((subcommand) => subcommand.startsWith(input))
					.map((subcommand) => ({ value: subcommand, label: subcommand }));
			}

			const sub = parts[0];
			const input = parts[parts.length - 1];

			if (parts.length === 2 && (sub === "use" || sub === "rm")) {
				const providers = sub === "use" ? getKnownProviders(store) : getSavedProviders(store);
				return providers
					.filter((provider) => provider.startsWith(input))
					.map((provider) => ({ value: provider, label: provider }));
			}

			if (parts.length === 3 && (sub === "use" || sub === "rm")) {
				const provider = parts[1];
				return getSlotNames(store, provider)
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
			if (sub === "name") {
				await handleName(parts[1], parts[2], ctx);
				return;
			}
			if (sub === "use") {
				await handleUse(parts[1], parts[2], ctx);
				return;
			}
			if (sub === "rm") {
				await handleRm(parts[1], parts[2], ctx);
				return;
			}
			if (sub) {
				ctx.ui.notify(`Unknown subcommand '${sub}'. Use: name, use, rm, status.`, "error");
				return;
			}
			await handleInteractive(ctx);
		},
	});
}
