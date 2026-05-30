/**
 * Lenient `edit` override.
 *
 * The built-in edit tool validates its arguments against a strict schema
 * (`additionalProperties: false` at both the top level and within each entry
 * of `edits[]`). When a model emits an extra property — e.g. a stray
 * `replaceAll`, `description`, or a duplicated `file_path` alongside `path`,
 * or per-edit junk like `{ oldText, newText, occurrence: 1 }` — the whole
 * call is rejected before it ever runs, wasting a turn.
 *
 * This wrapper keeps the strict schema (so the model still sees the correct,
 * minimal shape in the system prompt) but adds a `prepareArguments` shim that
 * runs *before* validation and discards unknown keys. Known fields are passed
 * through untouched, so behavior for well-formed calls is identical.
 *
 * Everything else — execution, file-mutation queueing, diff rendering — is
 * delegated to the genuine built-in implementation via the public
 * `createEditToolDefinition` factory. We do not reimplement edit.
 */

import { createEditToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Allowed keys, derived from the built-in edit schema.
const TOP_LEVEL_KEYS = ["path", "edits"] as const;
const EDIT_KEYS = ["oldText", "newText"] as const;

function pick<T extends object>(obj: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj && (obj as Record<string, unknown>)[k] !== undefined) {
      out[k] = (obj as Record<string, unknown>)[k];
    }
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
    cleaned.edits = ((cleaned as { edits: unknown[] }).edits).map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? pick(entry, EDIT_KEYS)
        : entry,
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
      // Run the built-in normalization first (handles edits-as-JSON-string and
      // legacy top-level oldText/newText), then drop any leftover unknown keys.
      const normalized = reference.prepareArguments ? reference.prepareArguments(args) : args;
      return stripUnknown(normalized) as ReturnType<NonNullable<typeof reference.prepareArguments>>;
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
}
