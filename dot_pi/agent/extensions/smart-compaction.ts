/**
 * Smart Compaction — context-aware file tracking in compaction summaries.
 *
 * Replaces the default `<read-files>` / `<modified-files>` blocks with
 * richer categorisation:
 *
 *   <uncommitted-changes>   — modified files that still show in `jj status`
 *   <committed-changes>     — modified files already committed
 *   <read-files>            — files that were only read (not modified)
 *
 * Read files are further filtered: any file that appears in the *kept*
 * (recent) messages is already visible to the LLM, so it's dropped from
 * the summary to save tokens.
 *
 * Falls back to default compaction on any error (no jj, API key missing, etc.).
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Minimum files from a directory before we consider collapsing. */
const DIR_COLLAPSE_MIN_FILES = 3;

/** Fraction of a directory's files that must be read to collapse. */
const DIR_COLLAPSE_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return stdout lines, or empty array on failure. */
async function execLines(
	pi: ExtensionAPI,
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<string[]> {
	try {
		const r = await pi.exec(cmd, args, { signal, timeout: 5000 });
		if (r.code !== 0) return [];
		return r.stdout
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

/** Get the set of files with uncommitted changes via `jj status`. */
async function getUncommittedFiles(pi: ExtensionAPI, signal?: AbortSignal): Promise<Set<string>> {
	// jj diff --stat gives lines like "  path/file | 3 +++"
	// jj status gives lines like "M path/file"
	const lines = await execLines(pi, "jj", ["status", "--no-pager"], signal);
	const files = new Set<string>();
	for (const line of lines) {
		// Lines look like: "M path/to/file" or "A path/to/file"
		const match = line.match(/^[MADR]\s+(.+)$/);
		if (match) files.add(match[1]);
	}
	return files;
}

/**
 * Extract file paths referenced in tool calls within messages.
 * Returns the set of all paths that appear in read/write/edit tool calls.
 */
function extractFilesFromMessages(messages: readonly any[]): Set<string> {
	const files = new Set<string>();
	for (const msg of messages) {
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (block.type !== "toolCall") continue;
			const name = block.name ?? block.toolName;
			if (["read", "write", "edit"].includes(name) && block.arguments?.path) {
				files.add(block.arguments.path);
			}
		}
	}
	return files;
}

/**
 * Collapse a list of file paths by directory when most of a directory was read.
 *
 * For each parent directory, if we read ≥ DIR_COLLAPSE_THRESHOLD of its
 * direct-child files (and at least DIR_COLLAPSE_MIN_FILES), replace the
 * individual entries with `dir/* (N of M files)`.
 *
 * Directories that don't exist on disk or can't be listed are left as-is.
 */
function collapseByDirectory(files: string[], cwd: string): string[] {
	// Group files by parent directory
	const byDir = new Map<string, string[]>();
	for (const f of files) {
		const dir = dirname(f);
		if (!byDir.has(dir)) byDir.set(dir, []);
		byDir.get(dir)!.push(f);
	}

	const result: string[] = [];

	for (const [dir, readFiles] of byDir) {
		if (readFiles.length < DIR_COLLAPSE_MIN_FILES) {
			// Too few files to bother collapsing
			result.push(...readFiles);
			continue;
		}

		// Count actual files (not dirs) that are direct children
		let totalFiles: number;
		try {
			const absDir = dir.startsWith("/") ? dir : join(cwd, dir);
			if (!existsSync(absDir)) {
				result.push(...readFiles);
				continue;
			}
			const entries = readdirSync(absDir, { withFileTypes: true });
			totalFiles = entries.filter((e) => e.isFile()).length;
		} catch {
			result.push(...readFiles);
			continue;
		}

		if (totalFiles === 0) {
			result.push(...readFiles);
			continue;
		}

		const fraction = readFiles.length / totalFiles;
		if (fraction >= DIR_COLLAPSE_THRESHOLD) {
			result.push(`${dir}/*`);
		} else {
			result.push(...readFiles);
		}
	}

	return result.sort();
}

// ---------------------------------------------------------------------------
// Prompt — same structured format as default pi, but instructs the model to
// produce the summary without file sections (we append our own).
// ---------------------------------------------------------------------------

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Produce a structured markdown checkpoint.

## Required sections

### Goal
What the user is trying to accomplish.

### Constraints & Preferences
Requirements and preferences mentioned by the user.

### Progress
#### Done
- [x] Completed items

#### In Progress
- [ ] Current work

#### Blocked
- Issues, if any

### Key Decisions
- **Decision**: Rationale

### Next Steps
1. What should happen next

### Critical Context
Data or details the next agent turn would need to continue seamlessly.

## Rules
- Be thorough but concise.
- Do NOT include file lists — those are handled separately.
- Output ONLY the markdown summary, nothing else.`;

const UPDATE_PROMPT_PREFIX = `Below is a previous session summary. Merge the new conversation into an updated summary following the same format.

<previous-summary>
{{PREVIOUS}}
</previous-summary>

`;

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, branchEntries, signal } = event;
		const {
			messagesToSummarize,
			turnPrefixMessages,
			tokensBefore,
			firstKeptEntryId,
			previousSummary,
			fileOps,
		} = preparation;

		// --- Resolve model + key (use current conversation model) ---------------
		const model = ctx.model;
		if (!model) return; // fall back to default

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) {
			ctx.ui.notify("Smart compaction: no API key, using default", "warning");
			return;
		}

		// --- Generate narrative summary via LLM --------------------------------
		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
		if (allMessages.length === 0) return;

		const conversationText = serializeConversation(convertToLlm(allMessages));

		let systemPrompt = SUMMARIZATION_PROMPT;
		if (previousSummary) {
			systemPrompt = UPDATE_PROMPT_PREFIX.replace("{{PREVIOUS}}", previousSummary) + systemPrompt;
		}

		let summary: string;
		try {
			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user" as const,
							content: [
								{
									type: "text" as const,
									text: `<conversation>\n${conversationText}\n</conversation>`,
								},
							],
							timestamp: Date.now(),
						},
					],
					system: systemPrompt,
				},
				{ apiKey, maxTokens: 8192, signal },
			);

			summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();

			if (!summary) {
				if (!signal?.aborted) ctx.ui.notify("Smart compaction: empty summary, using default", "warning");
				return;
			}
		} catch (error) {
			if (!signal?.aborted) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Smart compaction failed: ${msg}`, "error");
			}
			return; // fall back to default
		}

		// --- Categorise files ---------------------------------------------------

		// 1. Build read / modified sets from fileOps (same source as default pi)
		const modified = new Set([...fileOps.edited, ...fileOps.written]);
		const readOnly = new Set([...fileOps.read].filter((f) => !modified.has(f)));

		// 2. Figure out which files are already visible in kept messages.
		//    Anything from firstKeptEntryId onwards is still in context.
		const keptEntryIdx = branchEntries.findIndex((e) => e.id === firstKeptEntryId);
		const keptEntries = keptEntryIdx >= 0 ? branchEntries.slice(keptEntryIdx) : [];
		const keptMessages = keptEntries
			.filter((e) => e.type === "message")
			.map((e) => (e as any).message)
			.filter(Boolean);
		const filesInKeptContext = extractFilesFromMessages(keptMessages);

		// 3. Filter read-only: drop files the LLM can still see in kept context
		const readFilesForSummary = [...readOnly].filter((f) => !filesInKeptContext.has(f)).sort();

		// 4. Split modified files by commit status
		let uncommitted: Set<string>;
		try {
			uncommitted = await getUncommittedFiles(pi, signal);
		} catch {
			uncommitted = new Set();
		}

		const modifiedUncommitted = [...modified].filter((f) => uncommitted.has(f)).sort();
		const modifiedCommitted = [...modified].filter((f) => !uncommitted.has(f)).sort();

		// --- Collapse read files by directory ------------------------------------
		const collapsedReadFiles = collapseByDirectory(readFilesForSummary, ctx.cwd);

		// --- Build file sections ------------------------------------------------
		const sections: string[] = [];

		if (modifiedUncommitted.length > 0) {
			sections.push(`<uncommitted-changes>\n${modifiedUncommitted.join("\n")}\n</uncommitted-changes>`);
		}
		if (modifiedCommitted.length > 0) {
			sections.push(`<committed-changes>\n${modifiedCommitted.join("\n")}\n</committed-changes>`);
		}
		if (collapsedReadFiles.length > 0) {
			sections.push(`<read-files>\n${collapsedReadFiles.join("\n")}\n</read-files>`);
		}

		if (sections.length > 0) {
			summary += "\n\n" + sections.join("\n\n");
		}

		// --- Return custom compaction -------------------------------------------
		return {
			compaction: {
				summary,
				firstKeptEntryId,
				tokensBefore,
				details: {
					readFiles: readFilesForSummary,
					modifiedFiles: [...modified].sort(),
					uncommittedFiles: modifiedUncommitted,
					committedFiles: modifiedCommitted,
				},
			},
		};
	});
}
