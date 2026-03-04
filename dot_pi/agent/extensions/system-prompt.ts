/**
 * Replaces the default system prompt, keeping the dynamic sections
 * (project context, skills) while trimming static bloat and adding
 * environment-aware notes (jj detection, cwd guidance).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// ── jj detection ─────────────────────────────────────────────────────────────

async function isJjRepo(dir: string): Promise<boolean> {
	try {
		await access(path.join(dir, ".jj"));
		return true;
	} catch {
		return false;
	}
}

type JjState = { kind: "jj-repo"; root: string } | { kind: "jj-workspace" } | { kind: "none" };

async function detectJj(cwd: string): Promise<JjState> {
	if (await isJjRepo(cwd)) {
		return { kind: "jj-repo", root: cwd };
	}

	try {
		const { stdout } = await execFileAsync("jj", ["root"], { cwd, timeout: 3000 });
		const root = stdout.trim();
		if (root) return { kind: "jj-repo", root };
	} catch {}

	try {
		const entries = await readdir(cwd, { withFileTypes: true });
		const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
		const hasJj = await Promise.all(subdirs.map((d) => isJjRepo(path.join(cwd, d.name))));
		if (hasJj.some(Boolean)) return { kind: "jj-workspace" };
	} catch {}

	return { kind: "none" };
}

const JJ_USAGE = [
	"Use jj instead of git.",
	"The working copy is a commit (@) that auto-snapshots — no staging, no jj add.",
	"`jj describe` sets the message; `jj commit` does describe + creates a new empty change on top.",
	"`jj undo` reverses any operation.",
].join(" ");

function buildJjNote(state: JjState, cwd: string): string {
	switch (state.kind) {
		case "jj-repo":
			return `This is a jj (Jujutsu) repository${state.root !== cwd ? ` (root: ${state.root})` : ""}. ${JJ_USAGE}`;
		case "jj-workspace":
			return `This directory is a workspace whose subdirectories are jj (Jujutsu) repositories. ${JJ_USAGE}`;
		default:
			return "";
	}
}

// ── prompt construction ──────────────────────────────────────────────────────

const PREAMBLE = `You are running inside pi, a coding agent harness.

Non-obvious tool notes:
- Use read to examine files, not cat or sed.
- edit oldText must match exactly — read first to verify.
- interactive_shell instead of bash for: sudo, interactive prompts, GUI apps, long-running processes.
- brave_search / librarian: prefer over assumptions for external tools, libraries, or error messages.

Be concise for code tasks, thorough for design/planning. When asked for opinions, be direct and structured.`;

/**
 * Extract the dynamic tail from the built-in prompt.
 * Everything from "# Project Context" onward (context files, skills, date, cwd).
 * Falls back to just the date/cwd lines if the marker isn't found.
 */
function extractDynamicTail(builtinPrompt: string): string {
	const contextIdx = builtinPrompt.indexOf("\n# Project Context");
	if (contextIdx !== -1) {
		return builtinPrompt.slice(contextIdx);
	}

	// No project context — look for the skills section
	const skillsIdx = builtinPrompt.indexOf("\nThe following skills");
	if (skillsIdx !== -1) {
		return builtinPrompt.slice(skillsIdx);
	}

	// Fallback: grab the last two lines (date + cwd)
	const lines = builtinPrompt.split("\n");
	return "\n" + lines.slice(-2).join("\n");
}

export default function (pi: ExtensionAPI) {
	const startTime = new Date().toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const dynamicTail = extractDynamicTail(event.systemPrompt);

		const os = process.platform === "darwin" ? "macOS" : process.platform;
		const arch = process.arch;

		const notes: string[] = [
			`OS: ${os} (${arch}).`,
			`Prefer relative paths over cd + absolute paths.`,
		];

		const jjNote = buildJjNote(await detectJj(ctx.cwd), ctx.cwd);
		if (jjNote) notes.push(jjNote);

		// Replace the date/cwd lines at the end of the dynamic tail
		const tail = dynamicTail
			.replace(/\nCurrent date and time:.*/, "")
			.replace(/\nCurrent working directory:.*/, "");

		const prompt = [
			PREAMBLE,
			tail,
			notes.join("\n"),
			`As of the start of this conversation: ${startTime}`,
			`Current working directory: ${ctx.cwd}`,
		].join("\n");

		return { systemPrompt: prompt };
	});
}
