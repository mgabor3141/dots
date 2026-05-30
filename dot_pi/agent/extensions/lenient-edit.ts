/**
 * Lenient `edit` override.
 *
 * The built-in edit tool validates its arguments against a strict schema
 * (`additionalProperties: false` at both the top level and within each entry
 * of `edits[]`). When a model emits an extra property — e.g. a stray
 * `replaceAll`, `description`, or per-edit junk like `{ oldText, newText,
 * occurrence: 1 }` — the whole call is rejected before it ever runs, wasting a
 * turn.
 *
 * This wrapper does two things:
 *
 *   1. prepareArguments shim — runs before validation, applies the built-in
 *      normalization, then discards unknown keys so the call executes instead
 *      of failing. (Keeps the strict schema, so the model still sees the
 *      correct minimal shape in the system prompt.)
 *
 *   2. message_end rewrite — replaces the finalized assistant message so the
 *      *persisted* tool call (in the session jsonl) is the canonical, cleaned
 *      form. The model never sees its own malformed call in the history; it
 *      reads back as if it had called edit correctly the first time.
 *
 * Execution, file-mutation queueing, and diff rendering are delegated to the
 * genuine built-in implementation via the public `createEditToolDefinition`
 * factory. We do not reimplement edit.
 */

import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { createEditToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Allowed keys, derived from the built-in edit schema.
const TOP_LEVEL_KEYS = ["path", "edits"] as const;
const EDIT_KEYS = ["oldText", "newText"] as const;

function pick(obj: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (k in obj && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Strip unknown properties so a strict schema won't reject the call.
 * Only the whitelisted keys survive; known fields keep their values verbatim.
 */
function stripUnknown(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;

  const cleaned = pick(args as object, TOP_LEVEL_KEYS);

  if (Array.isArray((cleaned as { edits?: unknown }).edits)) {
    cleaned.edits = (cleaned as { edits: unknown[] }).edits.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry) ? pick(entry, EDIT_KEYS) : entry,
    );
  }

  return cleaned;
}

export default function (pi: ExtensionAPI) {
  // A reference definition used for static metadata, the built-in
  // prepareArguments normalization, the schema, and rendering. None of these
  // depend on the working directory (render slots receive `context.cwd`).
  let reference: ReturnType<typeof createEditToolDefinition>;
  try {
    reference = createEditToolDefinition(process.cwd());
  } catch (err) {
    // Factory unavailable (e.g. upstream refactor): leave the built-in edit
    // tool in place rather than registering a broken override.
    console.error(`lenient-edit: not installed (${String(err)})`);
    return;
  }

  // Canonicalize raw edit arguments the same way for both execution and the
  // persisted-history rewrite: built-in normalization, then strip unknowns.
  const canonicalize = (raw: unknown): unknown => {
    const normalized = reference.prepareArguments ? reference.prepareArguments(raw) : raw;
    return stripUnknown(normalized);
  };

  // execute() resolves relative paths against the closed-over cwd, so build a
  // per-cwd definition lazily and cache it.
  const byCwd = new Map<string, ReturnType<typeof createEditToolDefinition>>();
  const defFor = (cwd: string) => {
    let def = byCwd.get(cwd);
    if (!def) {
      def = createEditToolDefinition(cwd);
      byCwd.set(cwd, def);
    }
    return def;
  };

  pi.registerTool({
    name: "edit", // overrides the built-in edit tool
    label: reference.label,
    description: reference.description,
    // promptSnippet/promptGuidelines are NOT inherited on override — copy them
    // so the system prompt keeps the same edit guidance.
    promptSnippet: reference.promptSnippet,
    promptGuidelines: reference.promptGuidelines,
    parameters: reference.parameters, // strict schema, unchanged
    renderShell: reference.renderShell,

    prepareArguments(args) {
      return canonicalize(args) as ReturnType<NonNullable<typeof reference.prepareArguments>>;
    },

    execute(toolCallId, params, signal, onUpdate, ctx) {
      return defFor(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },

    // Delegate rendering to the genuine built-in renderers for an identical UI.
    renderCall(args, theme, context) {
      return reference.renderCall!(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return reference.renderResult!(result, options, theme, context);
    },
  });

  // Rewrite the finalized assistant message so the *persisted* edit tool call
  // is the cleaned form. This makes the conversation history read as if the
  // model had called edit correctly, instead of recording the malformed call
  // (which the model would otherwise see and potentially imitate).
  pi.on("message_end", (event) => {
    const msg = event.message;
    if (msg.role !== "assistant") return undefined;
    const assistant = msg as AssistantMessage;
    if (!Array.isArray(assistant.content)) return undefined;

    let changed = false;
    const newContent = assistant.content.map((block) => {
      if (!block || block.type !== "toolCall") return block;
      const call = block as ToolCall;
      if (call.name !== "edit") return block;

      const cleaned = canonicalize(call.arguments);
      // Only replace when the canonical form actually differs, to avoid
      // needless message churn (and to leave well-formed calls byte-identical).
      if (JSON.stringify(cleaned) === JSON.stringify(call.arguments)) return block;

      changed = true;
      return { ...call, arguments: cleaned as Record<string, unknown> };
    });

    if (!changed) return undefined;
    return { message: { ...assistant, content: newContent } };
  });
}
