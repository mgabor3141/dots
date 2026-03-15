/**
 * Smart Compaction — context-aware file tracking in compaction summaries.
 *
 * Keeps pi's built-in compaction summary, but replaces the default
 * `<read-files>` / `<modified-files>` blocks with richer categorisation:
 *
 *   <uncommitted-changes>   — modified files that still show in `jj status`
 *   <committed-changes>     — modified files already committed
 *   <read-files>            — files that were only read (not modified)
 *
 * Read files are further filtered: any file that appears in the *kept*
 * (recent) messages is already visible to the LLM, so it's dropped from
 * the summary to save tokens.
 *
 * Falls back to default compaction on any error.
 */

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Minimum files from a directory before we consider collapsing. */
const DIR_COLLAPSE_MIN_FILES = 3;

/** Fraction of a directory's files that must be read to collapse. */
const DIR_COLLAPSE_THRESHOLD = 0.75;

let compactModulePromise: Promise<{ compact: Function }> | undefined;

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
	const lines = await execLines(pi, "jj", ["status", "--no-pager"], signal);
	const files = new Set<string>();
	for (const line of lines) {
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
 * individual entries with `dir/*`.
 *
 * Directories that don't exist on disk or can't be listed are left as-is.
 */
function collapseByDirectory(files: string[], cwd: string): string[] {
	const byDir = new Map<string, string[]>();
	for (const f of files) {
		const dir = dirname(f);
		if (!byDir.has(dir)) byDir.set(dir, []);
		byDir.get(dir)!.push(f);
	}

	const result: string[] = [];
	for (const [dir, readFiles] of byDir) {
		if (readFiles.length < DIR_COLLAPSE_MIN_FILES) {
			result.push(...readFiles);
			continue;
		}

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

async function getPiCompact() {
	compactModulePromise ??= (async () => {
		const cliPath = process.argv[1];
		if (!cliPath) {
			throw new Error("pi CLI path unavailable");
		}
		const resolvedCliPath = realpathSync(cliPath);
		const compactionPath = join(dirname(resolvedCliPath), "core/compaction/compaction.js");
		return import(pathToFileURL(compactionPath).href);
	})();
	const module = await compactModulePromise;
	return module.compact;
}

function stripDefaultFileSections(summary: string): string {
	return summary
		.replace(/\n\n<modified-files>\n[\s\S]*?\n<\/modified-files>$/, "")
		.replace(/\n\n<read-files>\n[\s\S]*?\n<\/read-files>$/, "");
}

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, branchEntries, signal, customInstructions } = event;
		const { tokensBefore, firstKeptEntryId, fileOps } = preparation;

		const model = ctx.model;
		if (!model) return;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) {
			ctx.ui.notify("Smart compaction: no API key, using default", "warning");
			return;
		}

		let summary: string;
		try {
			const compact = await getPiCompact();
			const result = await compact(preparation, model, apiKey, customInstructions, signal);
			summary = stripDefaultFileSections(result.summary);
		} catch (error) {
			if (!signal?.aborted) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Smart compaction failed: ${msg}`, "error");
			}
			return;
		}

		const modified = new Set([...fileOps.edited, ...fileOps.written]);
		const readOnly = new Set([...fileOps.read].filter((f) => !modified.has(f)));

		const keptEntryIdx = branchEntries.findIndex((e) => e.id === firstKeptEntryId);
		const keptEntries = keptEntryIdx >= 0 ? branchEntries.slice(keptEntryIdx) : [];
		const keptMessages = keptEntries
			.filter((e) => e.type === "message")
			.map((e) => (e as any).message)
			.filter(Boolean);
		const filesInKeptContext = extractFilesFromMessages(keptMessages);

		const readFilesForSummary = [...readOnly].filter((f) => !filesInKeptContext.has(f)).sort();

		let uncommitted: Set<string>;
		try {
			uncommitted = await getUncommittedFiles(pi, signal);
		} catch {
			uncommitted = new Set();
		}

		const modifiedUncommitted = [...modified].filter((f) => uncommitted.has(f)).sort();
		const modifiedCommitted = [...modified].filter((f) => !uncommitted.has(f)).sort();
		const collapsedReadFiles = collapseByDirectory(readFilesForSummary, ctx.cwd);

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
