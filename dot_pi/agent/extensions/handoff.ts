/**
 * /handoff <goal>
 *
 * Summarize the current session into a focused handoff document, then launch
 * a fresh pi session in a gmux window seeded with that document.
 *
 * Reuses pi's compaction summarizer (generateSummary) so the doc shape matches
 * what /compact already produces: Goal / Constraints / Progress / Key Decisions
 * / Next Steps / Critical Context, plus file lists.
 *
 * The new session's header records parentSession = current session, so the
 * resume picker groups it under the parent in threaded sort mode.
 */
import {
	BorderedLoader,
	CURRENT_SESSION_VERSION,
	DEFAULT_COMPACTION_SETTINGS,
	type ExtensionAPI,
	generateSummary,
	type SessionEntry,
	type SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HANDOFF_DIR = join(homedir(), ".pi", "handoffs");

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "handoff"
	);
}

function timestampForFile(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Summarize this session and continue it in a background gmux pi window",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/handoff requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for the next session>", "error");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const messages = branch
				.filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
				.map((e) => e.message);

			if (messages.length === 0) {
				ctx.ui.notify("No conversation to hand off", "error");
				return;
			}

			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const model = ctx.model;

			// 1. Generate the summary using pi's own compaction summarizer.
			const summary = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, "Generating handoff summary…");
				loader.onAbort = () => done(null);

				(async () => {
					const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
					if (!auth.ok) throw new Error(auth.error);
					return generateSummary(
						messages,
						model,
						DEFAULT_COMPACTION_SETTINGS.reserveTokens,
						auth.apiKey,
						auth.headers,
						loader.signal,
						goal,
					);
				})()
					.then(done)
					.catch((err) => {
						console.error("Handoff summary failed:", err);
						done(null);
					});

				return loader;
			});

			if (summary === null) {
				ctx.ui.notify("Handoff cancelled", "info");
				return;
			}

			// 2. Compose the handoff document and let the user review/edit.
			const initialDoc = [
				`# Handoff`,
				``,
				`**Goal for this session:** ${goal}`,
				``,
				`**Parent session:** \`${parentSessionFile ?? "(unsaved)"}\``,
				``,
				summary,
				``,
			].join("\n");

			const editedDoc = await ctx.ui.editor("Edit handoff document", initialDoc);
			if (editedDoc === undefined) {
				ctx.ui.notify("Handoff cancelled", "info");
				return;
			}

			// 3. Write the handoff doc.
			await mkdir(HANDOFF_DIR, { recursive: true });
			const handoffPath = join(HANDOFF_DIR, `${timestampForFile()}-${slugify(goal)}.md`);
			await writeFile(handoffPath, editedDoc, "utf8");

			// 4. Pre-create the new session file with parentSession set in the header.
			//    pi --session=<path> will pick it up and append from there.
			if (!parentSessionFile) {
				ctx.ui.notify("Current session is unsaved; cannot link parent. Aborting.", "error");
				return;
			}
			const sessionDir = dirname(parentSessionFile);
			const sessionId = randomUUID();
			const timestamp = new Date().toISOString();
			const newSessionFile = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
			const header: SessionHeader = {
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: sessionId,
				timestamp,
				cwd: process.cwd(),
				parentSession: parentSessionFile,
			};
			await writeFile(newSessionFile, `${JSON.stringify(header)}\n`, "utf8");

			// 5. Launch pi in a gmux window with the handoff doc as the first message.
			const initialPrompt = `Read the handoff document at ${handoffPath} and continue the work described there.`;
			const gmuxArgs = ["--no-attach", "pi", "--session", newSessionFile, initialPrompt];

			const result = await pi.exec("gmux", gmuxArgs, { timeout: 30_000 });
			if (result.code !== 0) {
				ctx.ui.notify(
					`gmux failed (exit ${result.code}): ${result.stderr.trim() || "no stderr"}`,
					"error",
				);
				return;
			}

			const gmuxId = result.stdout.trim().split(/\s+/).pop() ?? "?";
			ctx.ui.notify(
				`Handoff launched. gmux=${gmuxId}  doc=${handoffPath}`,
				"info",
			);
		},
	});
}
