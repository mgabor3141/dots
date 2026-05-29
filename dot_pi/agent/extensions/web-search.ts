import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, Api } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnvKey(key: string): string | null {
  if (process.env[key]) return process.env[key];
  const envPath = join(homedir(), ".env");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, v] = trimmed.split("=", 2);
    if (k === key) return v.trim();
  }
  return null;
}

const BASE_URL = loadEnvKey("SEARXNG_URL") || "http://localhost:8080";
const CRAWL_URL = loadEnvKey("CRAWL_URL") || "https://crawl.mgabor.hu/crawl";
const TOKEN = loadEnvKey("SEARXNG_TOKEN");

// Thresholds
const MIN_SUMMARY = 5_000;  // under this: return as-is
const MAX_CONTENT = 2_000_000; // above this: refuse
const MAX_OUTPUT = 5_000;   // hard cap on final output

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number,
): Promise<Response> {
  let lastError: Error | null = null;
  const signal = options.signal as AbortSignal | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await fetch(url, options);
      if (!response.ok && (response.status >= 500 || response.status === 429)) {
        const waitMs = attempt * 2000;
        const cloned = response.clone();
        const body = await cloned.text();
        lastError = new Error(`HTTP ${response.status}: ${body}`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("abort")) throw err;
      lastError = err instanceof Error ? err : new Error(message);
      if (attempt < maxRetries) {
        const waitMs = attempt * 2000;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastError ?? new Error("fetch failed");
}

/**
 * Resolve an auxiliary model from PI_LIBRARIAN_MODELS.
 * Returns { model, apiKey } or null if none available.
 */
async function resolveAuxModel(ctx: ExtensionContext): Promise<{ model: Model<Api>; apiKey: string } | null> {
  const modelsStr = process.env.PI_LIBRARIAN_MODELS;
  if (!modelsStr) return null;

  // Parse: "provider/model:thinking,provider2/model2:thinking2"
  const candidates = modelsStr.replace(/"/g, "").split(",").map(s => s.trim()).filter(Boolean);
  for (const spec of candidates) {
    // Split on last colon to handle thinking level
    const colonIdx = spec.lastIndexOf(":");
    const modelPart = colonIdx > 0 ? spec.slice(0, colonIdx) : spec;
    const slashIdx = modelPart.indexOf("/");
    if (slashIdx < 0) continue;
    const provider = modelPart.slice(0, slashIdx);
    const modelId = modelPart.slice(slashIdx + 1);

    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) continue;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok && auth.apiKey) {
      return { model, apiKey: auth.apiKey };
    }
  }
  return null;
}

/**
 * Call the auxiliary LLM to summarize content.
 */
async function summarizeWithLlm(
  content: string,
  url: string,
  title: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<string | null> {
  const aux = await resolveAuxModel(ctx);
  if (!aux) return null;

  const { model, apiKey } = aux;
  const provider = getApiProvider(model.api);
  if (!provider) return null;

  const contextInfo = [title && `Title: ${title}`, url && `Source: ${url}`]
    .filter(Boolean).join("\n");

  const prompt =
    "Create a comprehensive yet concise markdown summary that preserves ALL important " +
    "information while dramatically reducing bulk. Include key excerpts (quotes, code snippets, " +
    "important facts) in their original format. Use headers, bullets, and emphasis for scannability. " +
    `Max ${MAX_OUTPUT} characters.\n\n${contextInfo}\n\nCONTENT:\n${content}`;

  const stream = provider.streamSimple(
    model,
    { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
    { apiKey, signal, maxTokens: 8000, temperature: 0.1 },
  );

  let result = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      result += event.delta;
    } else if (event.type === "error") {
      return null;
    }
  }

  // Enforce output cap
  if (result.length > MAX_OUTPUT) {
    result = result.slice(0, MAX_OUTPUT) + "\n\n[... summary truncated ...]";
  }

  return result || null;
}

/**
 * Process content with LLM summarization (Hermes-style tiered approach).
 */
async function processContent(
  content: string,
  url: string,
  title: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<string> {
  const len = content.length;

  // Refuse if absurdly large
  if (len > MAX_CONTENT) {
    const mb = (len / 1_000_000).toFixed(1);
    return `[Content too large (${mb}MB > 2MB limit). Try a more focused source or use web_search for an overview.]`;
  }

  // Under threshold: return as-is
  if (len < MIN_SUMMARY) {
    return content;
  }

  // Try LLM summarization
  const summarized = await summarizeWithLlm(content, url, title, ctx, signal);
  if (summarized) return summarized;

  // Fallback: return truncated raw content
  const truncated = content.slice(0, MAX_OUTPUT);
  if (len > MAX_OUTPUT) {
    return truncated + `\n\n[Content truncated — showing first ${MAX_OUTPUT.toLocaleString()} of ${len.toLocaleString()} chars. Summarization unavailable.]`;
  }
  return truncated;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via a local SearXNG instance. Returns results with title, URL, and snippet. " +
      "Use for web research questions.",
    promptSnippet:
      "Use for web research questions. Returns numbered list of title/URL/snippet results.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numberResults: Type.Optional(
        Type.Number({ description: "Number of results (default 5, max 20)" })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const url = new URL("/search", BASE_URL);
      url.searchParams.set("q", params.query);
      url.searchParams.set("format", "json");
      const n = Math.min(params.numberResults ?? 5, 20);
      url.searchParams.set("number_of_results", String(n));
      url.searchParams.set("language", "en");

      const headers: Record<string, string> = {};
      if (TOKEN !== null) headers["Authorization"] = `Bearer ${TOKEN}`;

      const response = await fetchWithRetry(url.toString(), { signal, headers }, 3);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`SearXNG error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const allResults = (data.results || []) as any[];
      const results = allResults.slice(0, n).map((r: any, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || r.content || ""}`
      );

      return {
        content: [{ type: "text", text: results.join("\n\n") || "No results found." }],
        details: { resultCount: results.length, totalAvailable: allResults.length },
      };
    },
  });

  pi.registerTool({
    name: "web_view",
    label: "View Page",
    description:
      "Fetch and return the text content of a URL. " +
      "Use to read a specific page from search results. " +
      "Pages under 5000 chars are returned as-is; larger pages are summarized automatically.",
    promptSnippet:
      "Use to read the full content of a URL. Large pages are summarized to save context.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (TOKEN !== null) headers["Authorization"] = `Bearer ${TOKEN}`;

      const response = await fetchWithRetry(CRAWL_URL, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({
          urls: [params.url],
          crawler_config: {
            type: "CrawlerRunConfig",
            params: {
              markdown_generator: {
                type: "DefaultMarkdownGenerator",
                params: {
                  content_filter: {
                    type: "PruningContentFilter",
                    params: {
                      threshold: 0.48,
                      threshold_type: "dynamic",
                      min_word_threshold: 5,
                    },
                  },
                },
              },
            },
          },
        }),
      }, 3);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Crawl error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const rawContent = data.content || data.text || data.html || JSON.stringify(data);
      const title = data.title || "";

      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      // Process with tiered summarization
      const content = await processContent(rawContent, params.url, title, ctx, signal);

      return {
        content: [{ type: "text", text: content }],
        details: { url: params.url, originalSize: rawContent.length, finalSize: content.length },
      };
    },
  });
}
