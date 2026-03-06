/**
 * LLM-as-judge guardrail for dangerous commands and sensitive file access.
 *
 * Calls Haiku to evaluate flagged actions in context. Haiku can:
 *   - approve (action is obviously safe in this context)
 *   - deny   (action is genuinely dangerous)
 *   - unsure (escalate to the user with an explanation)
 *
 * Covers:
 *   - Dangerous bash commands (dd, mkfs, chmod 777, chown -R)
 *   - Sensitive file access (.env, .env.local, .env.production, .dev.vars)
 *
 * Falls back to user confirmation on LLM errors or timeouts.
 */

import type { ExtensionAPI, ExtensionContext, SessionMessageEntry, ToolCallEvent, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model, TextContent } from "@mariozechner/pi-ai";
import * as path from "node:path";
import { sendNotification } from "./lib/notify.js";

// --- Configuration ---

const JUDGE_PROVIDER = "anthropic";
const JUDGE_MODEL_ID = "claude-haiku-4-5";
const JUDGE_TIMEOUT_MS = 10_000;
const TRUST_ENTRY_TYPE = "smart-guard:trust";

/** Max recent tool calls/results to include as context for the judge. */
const CONTEXT_TOOL_CALLS = 6;
/** Max characters per tool result excerpt. */
const CONTEXT_EXCERPT_LEN = 300;

// --- Dangerous bash patterns ---

const DANGEROUS_PATTERNS: { pattern: RegExp; description: string }[] = [
	{ pattern: /\bdd\s+if=/, description: "dd disk write" },
	{ pattern: /\bmkfs\./, description: "filesystem format" },
	{ pattern: /\bchmod\b.*\b777\b/, description: "chmod 777" },
	{ pattern: /\bchown\s+-R\b/, description: "recursive chown" },
];

// --- Env file detection ---

const ENV_PATTERNS = [".env", ".env.local", ".env.production", ".env.prod", ".dev.vars"];
const ENV_SAFE = [".env.example", ".env.sample", ".env.test"];

function isEnvFile(filePath: string): boolean {
	const base = path.basename(filePath);
	if (ENV_SAFE.some((s) => base === path.basename(s))) return false;
	return ENV_PATTERNS.some((p) => base === path.basename(p) || base.startsWith(path.basename(p) + "."));
}

/** Bash commands that touch .env files or dump/exfiltrate environment variables. */
const ENV_BASH_PATTERNS: { pattern: RegExp; description: string }[] = [
	{ pattern: /\b(cat|less|head|tail|bat|more|strings)\b.*\.env\b/, description: "read env file via shell" },
	{ pattern: /\b(grep|rg|ag|ack)\b.*\.env\b/, description: "search in env file via shell" },
	{ pattern: /\b(base64|xxd|od)\b.*\.env\b/, description: "encode env file" },
	{ pattern: /\bsource\b.*\.env\b/, description: "source env file into shell" },
	{ pattern: /\.\s+\S*\.env\b/, description: "dot-source env file" },
	{ pattern: /\bcp\b.*\.env\b/, description: "copy env file" },
	{ pattern: /\bmv\b.*\.env\b/, description: "move env file" },
	{ pattern: /\b(curl|wget|nc|ncat)\b.*\.env\b/, description: "transfer env file over network" },
	{ pattern: /\b(curl|wget|nc|ncat)\b.*\$\{?[A-Z_]/, description: "HTTP request with env variable expansion" },
	{ pattern: /\bprintenv\b/, description: "dump environment variables" },
	{ pattern: /\benv\b\s*($|\|)/, description: "dump environment variables" },
	{ pattern: /\bset\b\s*($|\|)/, description: "dump shell variables" },
	{ pattern: /\bexport\b\s+-p\b/, description: "dump exported variables" },
	{ pattern: /\bdocker\b.*(-e|--env-file)\b/, description: "docker env passthrough" },
];

// --- Prompt ---

const SYSTEM_PROMPT = `You are a security guardrail for an AI coding agent. You evaluate actions that matched a safety pattern.

Your job: decide if the action is safe to proceed WITHOUT interrupting the user.

Context you receive:
- The action (a bash command or file access)
- Why it was flagged
- The agent's working directory
- Recent conversation context (last few tool calls and messages)

Respond with exactly one JSON object (no markdown fencing):
{ "verdict": "approve" | "deny" | "unsure", "reason": "<one sentence explanation>" }

Guidelines for dangerous commands:
- approve: routine/safe in a development context (e.g. dd for test disk images, chmod on project files, chown to fix ownership, deleting something the agent just created)
- deny: targets system-critical paths (/, /etc, /boot, /System), would destroy data not created by the agent, or is clearly malicious
- unsure: you can't confidently determine safety

Guidelines for .env file access:
- approve: the agent is reading/writing .env files as part of normal project setup, configuration, or debugging that the user clearly requested
- deny: the agent is trying to exfiltrate secrets, copy env contents to unexpected locations, or access .env files unrelated to the current task
- unsure: you can't tell if the access is task-related

Be pragmatic. Developers work with these files and commands constantly. Err toward approve for typical dev workflows.`;

// --- Implementation ---

export default function (pi: ExtensionAPI) {
	let trustDirectives: string[] = [];

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.modelRegistry.find(JUDGE_PROVIDER, JUDGE_MODEL_ID)) {
			ctx.ui.notify(`smart-guard: model ${JUDGE_PROVIDER}/${JUDGE_MODEL_ID} not found, will fall back to user confirmation`, "warning");
		}
		// Restore trust directives from session (null entry = reset)
		trustDirectives = [];
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && (entry as any).customType === TRUST_ENTRY_TYPE) {
				const data = (entry as any).data;
				if (data === null) {
					trustDirectives = [];
				} else {
					trustDirectives.push(data as string);
				}
			}
		}
	});

	pi.registerCommand("guard", {
		description: "Manage smart-guard: /guard <trust directive> or /guard reset",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				if (trustDirectives.length === 0) {
					ctx.ui.notify("No trust directives set for this session.");
				} else {
					ctx.ui.notify(`Trust directives:\n${trustDirectives.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`);
				}
				return;
			}
			if (trimmed === "reset") {
				trustDirectives = [];
				pi.appendEntry(TRUST_ENTRY_TYPE, null);
				ctx.ui.notify("🛡️ Trust directives cleared for this session.");
				return;
			}
			trustDirectives.push(trimmed);
			pi.appendEntry(TRUST_ENTRY_TYPE, trimmed);
			ctx.ui.notify(`🛡️ Trust directive added: ${trimmed}`);
		},
	});

	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
		// Check for dangerous bash commands and env-related shell access
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command;
			const matched = DANGEROUS_PATTERNS.find((p) => p.pattern.test(command))
				?? ENV_BASH_PATTERNS.find((p) => p.pattern.test(command));
			if (matched) {
				return evaluate(ctx, `bash: ${command}`, matched.description, trustDirectives);
			}
		}

		// Check for .env file access
		const target = getFilePath(event);
		if (target && isEnvFile(target)) {
			return evaluate(ctx, `${event.toolName} ${target}`, "access to sensitive env file", trustDirectives);
		}
	});
}

/** Extract file path from a tool call event, if applicable. */
function getFilePath(event: ToolCallEvent): string | undefined {
	if (isToolCallEventType("read", event)) return event.input.path;
	if (isToolCallEventType("write", event)) return event.input.path;
	if (isToolCallEventType("edit", event)) return event.input.path;
	if (isToolCallEventType("grep", event)) return event.input.path;
	return undefined;
}

/** Run the LLM judge for a flagged action. Falls back to user on error. */
async function evaluate(ctx: ExtensionContext, action: string, flagReason: string, trustDirectives: string[]): Promise<ToolCallEventResult | void> {
	const judgeModel = ctx.modelRegistry.find(JUDGE_PROVIDER, JUDGE_MODEL_ID);
	if (!judgeModel) {
		return askUser(ctx, action, flagReason, "model unavailable");
	}

	const apiKey = await ctx.modelRegistry.getApiKey(judgeModel);
	if (!apiKey) {
		return askUser(ctx, action, flagReason, "no API key");
	}

	const recentContext = gatherContext(ctx);

	try {
		const verdict = await callJudge(judgeModel, apiKey, action, flagReason, ctx.cwd, recentContext, trustDirectives);

		if (verdict.verdict === "approve") {
			ctx.ui.notify(`✅ ${flagReason}: ${verdict.reason}`);
			return;
		}

		if (verdict.verdict === "deny") {
			sendNotification({ title: "🛡️ Blocked", body: `${flagReason}: ${verdict.reason}`, cwd: ctx.cwd });
			return { block: true, reason: `🛡️ Blocked: ${verdict.reason}` };
		}

		// unsure → ask the user with Haiku's explanation
		sendNotification({ title: "⚠️ Approve action?", body: `${flagReason}: ${action}`, cwd: ctx.cwd,  });
		return askUser(ctx, action, flagReason, undefined, verdict.reason);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		sendNotification({ title: "⚠️ Approve action?", body: `${flagReason}: ${action}`, cwd: ctx.cwd });
		return askUser(ctx, action, flagReason, msg);
	}
}

/**
 * Gather recent conversation context: tool calls, tool results, and the last user/assistant text.
 * Keeps it compact so Haiku gets enough signal without blowing up the prompt.
 */
function gatherContext(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	const lines: string[] = [];
	let toolItems = 0;

	for (let i = branch.length - 1; i >= 0 && toolItems < CONTEXT_TOOL_CALLS; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;

		const msg = (entry as SessionMessageEntry).message;

		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (toolItems >= CONTEXT_TOOL_CALLS) break;
				if (block.type === "toolCall") {
					const args = JSON.stringify(block.arguments);
					const truncated = args.length > CONTEXT_EXCERPT_LEN ? args.slice(0, CONTEXT_EXCERPT_LEN) + "…" : args;
					lines.unshift(`  [tool_call] ${block.name}: ${truncated}`);
					toolItems++;
				} else if (block.type === "text" && toolItems === 0) {
					const text = block.text.length > CONTEXT_EXCERPT_LEN ? block.text.slice(0, CONTEXT_EXCERPT_LEN) + "…" : block.text;
					lines.unshift(`  [assistant] ${text}`);
				}
			}
		} else if (msg.role === "toolResult") {
			if (toolItems >= CONTEXT_TOOL_CALLS) break;
			const text = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join(" ");
			const truncated = text.length > CONTEXT_EXCERPT_LEN ? text.slice(0, CONTEXT_EXCERPT_LEN) + "…" : text;
			lines.unshift(`  [tool_result] ${msg.toolName}: ${truncated}`);
			toolItems++;
		} else if (msg.role === "user" && toolItems === 0) {
			const text = typeof msg.content === "string"
				? msg.content
				: msg.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join(" ");
			const truncated = text.length > CONTEXT_EXCERPT_LEN ? text.slice(0, CONTEXT_EXCERPT_LEN) + "…" : text;
			lines.unshift(`  [user] ${truncated}`);
			break;
		}
	}

	return lines.join("\n");
}

// --- LLM judge ---

interface Verdict {
	verdict: "approve" | "deny" | "unsure";
	reason: string;
}

/** Extract a valid verdict from LLM output, tolerating markdown fences and surrounding text. */
function parseVerdict(text: string): Verdict {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error(`no JSON object found in response: ${text.slice(0, 200)}`);
	}
	const parsed = JSON.parse(text.slice(start, end + 1));
	if (!["approve", "deny", "unsure"].includes(parsed.verdict)) {
		throw new Error(`invalid verdict "${parsed.verdict}" in response: ${text.slice(0, 200)}`);
	}
	return { verdict: parsed.verdict, reason: parsed.reason ?? "" };
}

async function callJudge(
	model: Model<Api>,
	apiKey: string,
	action: string,
	flagReason: string,
	cwd: string,
	recentContext: string,
	trustDirectives: string[],
): Promise<Verdict> {
	const parts = [
		`Action: ${action}`,
		`Flagged because: ${flagReason}`,
		`Working directory: ${cwd}`,
	];
	if (trustDirectives.length > 0) {
		parts.push("", "User trust directives for this session:", ...trustDirectives.map((d) => `  - ${d}`));
	}
	if (recentContext) {
		parts.push("", "Recent agent activity:", recentContext);
	}
	const userMessage = parts.join("\n");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);

	try {
		const response = await completeSimple(model, {
			systemPrompt: SYSTEM_PROMPT,
			messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
		}, {
			apiKey,
			signal: controller.signal,
			maxTokens: 150,
			temperature: 0,
		});

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		return parseVerdict(text);
	} finally {
		clearTimeout(timeout);
	}
}

// --- User fallback ---

async function askUser(
	ctx: ExtensionContext,
	action: string,
	flagReason: string,
	fallbackReason?: string,
	explanation?: string,
): Promise<ToolCallEventResult | void> {
	if (!ctx.hasUI) {
		return { block: true, reason: `Flagged action (${flagReason}) blocked — no UI for confirmation` };
	}

	const lines = [`⚠️ Flagged: ${flagReason}`];
	if (explanation) lines.push(`\n🤖 Haiku: ${explanation}`);
	if (fallbackReason) lines.push(`\n(judge fallback: ${fallbackReason})`);
	lines.push(`\n  ${action}\n`);

	const choice = await ctx.ui.select(lines.join("\n"), ["Allow", "Deny"]);
	if (choice === "Allow") return;
	return { block: true, reason: "Blocked by user" };
}
