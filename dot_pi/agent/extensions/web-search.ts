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
 * Call the auxiliary LLM to summarize content. When `query` is set, the
 * summary is steered toward what the caller is looking for.
 */
async function summarizeWithLlm(
  content: string,
  url: string,
  title: string,
  ctx: ExtensionContext,
  query: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const aux = await resolveAuxModel(ctx);
  if (!aux) return null;

  const { model, apiKey } = aux;
  const provider = getApiProvider(model.api);
  if (!provider) return null;

  const contextInfo = [title && `Title: ${title}`, url && `Source: ${url}`]
    .filter(Boolean).join("\n");

  const focus = query
    ? `The reader is specifically looking for: "${query}". Lead with and prioritize ` +
      `information relevant to that, but still capture other key facts. `
    : "";

  const prompt =
    "Create a comprehensive yet concise markdown summary that preserves ALL important " +
    "information while dramatically reducing bulk. Include key excerpts (quotes, code snippets, " +
    "important facts) in their original format. Use headers, bullets, and emphasis for scannability. " +
    "CRITICAL: Use ONLY information present in the content below. Reproduce numbers, names, " +
    "quotes, and figures exactly as they appear — never invent, round, estimate, extrapolate, or " +
    "infer values that are not explicitly stated. Do not synthesize tables or stats from prose. " +
    "If something is unclear or absent, omit it rather than guessing. " +
    focus +
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
  query: string | undefined,
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
  const summarized = await summarizeWithLlm(content, url, title, ctx, query, signal);
  if (summarized) return summarized;

  // Fallback: return truncated raw content
  const truncated = content.slice(0, MAX_OUTPUT);
  if (len > MAX_OUTPUT) {
    return truncated + `\n\n[Content truncated — showing first ${MAX_OUTPUT.toLocaleString()} of ${len.toLocaleString()} chars. Summarization unavailable.]`;
  }
  return truncated;
}

// Content types that are useful as raw text but that crawl4ai's headless
// Chromium either refuses to navigate (served as a download) or renders
// poorly. We GET these directly instead of routing through the browser.
const DIRECT_TEXT_CTYPE =
  /^(text\/(plain|markdown|x-markdown|csv)|application\/(json|ld\+json|xml|x-ndjson)|application\/rss\+xml|application\/atom\+xml)/i;

/**
 * Probe a URL before crawling. crawl4ai drives Playwright, which aborts
 * navigation with "Download is starting" whenever the server responds
 * with `Content-Disposition: attachment` (e.g. HedgeDoc /download links,
 * raw .md files). For those — and for raw-text content types the browser
 * can't render — fetch the body directly. Returns null for normal pages
 * (HTML, or anything we can't cheaply classify), which fall through to
 * the crawler exactly as before.
 */
async function preflightDirectFetch(
  url: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; title: string } | null> {
  // Clean headers: do NOT send the crawl service's bearer token or the
  // application/json Content-Type to the *target* origin.
  const probeHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; pi-web-view/1.0)",
  };

  let head: Response;
  try {
    head = await fetch(url, {
      method: "HEAD",
      signal,
      headers: probeHeaders,
      redirect: "follow",
    });
  } catch {
    return null; // HEAD unsupported/blocked -> let the crawler try.
  }
  if (!head.ok) return null;

  const disp = head.headers.get("content-disposition") || "";
  const ctype = head.headers.get("content-type") || "";
  const isAttachment = /attachment/i.test(disp);
  const isDirectText = DIRECT_TEXT_CTYPE.test(ctype);

  // Normal navigable page: leave it to the crawler.
  if (!isAttachment && !isDirectText) return null;

  const fnMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
  const title = fnMatch?.[1] ? decodeURIComponent(fnMatch[1]) : "";

  // Attachment with a non-text body (pdf, zip, image, ...): the browser
  // can't extract it and neither can we usefully. Report instead of
  // dumping bytes into context.
  if (isAttachment && !isDirectText && !/^text\//i.test(ctype)) {
    return {
      text: `[${url} is a ${ctype || "binary"} download (${disp || "attachment"}); not fetched as text.]`,
      title,
    };
  }

  let resp: Response;
  try {
    resp = await fetch(url, { signal, headers: probeHeaders, redirect: "follow" });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  const text = await resp.text();
  return { text, title };
}

/** Build the crawl4ai markdown content_filter config. */
function buildContentFilter(query: string | undefined) {
  // With a query: BM25 ranks query-relevant chunks (cheap, keyword-based,
  // narrows content before it leaves the crawler). Without: prune boilerplate.
  const content_filter = query
    ? {
        type: "BM25ContentFilter",
        params: { user_query: query, bm25_threshold: 1.2 },
      }
    : {
        type: "PruningContentFilter",
        params: { threshold: 0.48, threshold_type: "dynamic", min_word_threshold: 5 },
      };
  return {
    type: "CrawlerRunConfig",
    params: {
      markdown_generator: {
        type: "DefaultMarkdownGenerator",
        params: { content_filter },
      },
    },
  };
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
      "Fetch and return the readable content of one or more URLs (max 5). " +
      "Boilerplate is stripped automatically; pages under 5000 chars are returned as-is, " +
      "larger pages are summarized. Provide `query` to describe what you're looking for — " +
      "it narrows the fetched content to relevant sections and steers the summary.",
    promptSnippet:
      "Use to read the content of URLs. Pass `query` to focus on what you need. Large pages are summarized.",
    parameters: Type.Object({
      urls: Type.Array(Type.String(), {
        description: "URLs to fetch (max 5)",
      }),
      query: Type.Optional(
        Type.String({
          description:
            "What you're looking for on the page(s). Narrows content to relevant " +
            "sections and focuses the summary.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const urls = params.urls.slice(0, 5);
      if (urls.length === 0) {
        throw new Error("web_view requires at least one URL");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (TOKEN !== null) headers["Authorization"] = `Bearer ${TOKEN}`;

      // Pre-flight: peel off URLs that are downloads or raw-text resources
      // the headless browser can't navigate (Playwright aborts with
      // "Download is starting" on Content-Disposition: attachment). These
      // are fetched directly; the rest go to crawl4ai in one batch.
      const direct = new Map<string, { text: string; title: string }>();
      await Promise.all(
        urls.map(async (u) => {
          const pf = await preflightDirectFetch(u, signal).catch(() => null);
          if (pf) direct.set(u, pf);
        })
      );
      const toCrawl = urls.filter((u) => !direct.has(u));

      const byUrl = new Map<string, any>();
      if (toCrawl.length > 0) {
        const response = await fetchWithRetry(CRAWL_URL, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            urls: toCrawl,
            crawler_config: buildContentFilter(params.query),
          }),
        }, 3);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Crawl error ${response.status}: ${text}`);
        }

        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        const data = await response.json();
        const results = (data.results || []) as any[];
        // Map results by URL so output order matches the request. Key under
        // both the original and redirected URL so either form resolves.
        for (const r of results) {
          if (r.url) byUrl.set(r.url, r);
          if (r.redirected_url) byUrl.set(r.redirected_url, r);
        }
      }

      const sections = await Promise.all(
        urls.map(async (reqUrl) => {
          const pf = direct.get(reqUrl);
          if (pf) {
            const text = await processContent(pf.text, reqUrl, pf.title, ctx, params.query, signal);
            return { url: reqUrl, text, size: pf.text.length };
          }
          const r = byUrl.get(reqUrl);
          if (!r || r.success === false) {
            const err = r?.error_message || "failed to fetch";
            return { url: reqUrl, text: `[Error fetching ${reqUrl}: ${err}]`, size: 0 };
          }
          const md = r.markdown || {};
          const raw =
            md.fit_markdown || md.raw_markdown || r.cleaned_html || "";
          const title = r.metadata?.title || "";
          const text = await processContent(raw, reqUrl, title, ctx, params.query, signal);
          return { url: reqUrl, text, size: raw.length };
        })
      );

      const body =
        urls.length === 1
          ? sections[0].text
          : sections.map((s) => `## ${s.url}\n\n${s.text}`).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: body || "No content found." }],
        details: {
          urls,
          query: params.query,
          sizes: sections.map((s) => s.size),
        },
      };
    },
  });
}
