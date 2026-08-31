import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
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

const MAX_CONTENT = 2_000_000; // direct non-HTML fetch safety limit

function formatToolCall(
  name: string,
  primaryKey: string,
  args: Record<string, unknown>,
  theme: Theme,
  hiddenKeys: string[] = [],
): string {
  const primary = args[primaryKey];
  let text = theme.fg("toolTitle", theme.bold(name));
  if (primary !== undefined) {
    const rendered = typeof primary === "string" ? primary : JSON.stringify(primary);
    text += ` ${theme.fg("accent", rendered)}`;
  }

  const extras = Object.entries(args)
    .filter(
      ([key, value]) =>
        key !== primaryKey && !hiddenKeys.includes(key) && value !== undefined,
    )
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  if (extras.length > 0) {
    text += theme.fg("toolOutput", ` (${extras.join(", ")})`);
  }
  return text;
}

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

// Content types the headless browser actually renders. Everything else
// (scripts, json, yaml, octet-stream, archives, ...) Chromium tries to
// *download*, and Playwright then aborts navigation with "Download is
// starting". So the crawler is only useful for these.
const BROWSER_RENDERS = /^(text\/html|application\/xhtml\+xml)/i;

/** Heuristic: does this byte sample look like binary (vs decodable text)? */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 1024);
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true; // NUL byte -> definitely binary
    // Control chars outside tab/LF/CR/FF and the printable range.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.1;
}

/**
 * Probe a URL before crawling. crawl4ai drives Playwright, which aborts
 * navigation with "Download is starting" whenever the server responds
 * with `Content-Disposition: attachment` OR a non-renderable content type
 * (e.g. application/x-sh for install.sh, raw .md served as text/markdown,
 * application/octet-stream, json/yaml). For all of those we fetch the body
 * directly. Returns null for HTML pages and for anything we can't classify,
 * which fall through to the crawler exactly as before.
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
  const ctype = (head.headers.get("content-type") || "").toLowerCase();
  const isAttachment = /attachment/i.test(disp);

  // Renderable HTML and not a forced download: let the crawler do its job.
  if (BROWSER_RENDERS.test(ctype) && !isAttachment) return null;
  // No content-type and no attachment hint: can't classify -> let the
  // browser decide (it usually renders these as HTML).
  if (!ctype && !isAttachment) return null;

  const fnMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
  const title = fnMatch?.[1] ? decodeURIComponent(fnMatch[1]) : "";

  // Bail early on declared oversize bodies before downloading them.
  const clen = Number(head.headers.get("content-length") || 0);
  if (clen > MAX_CONTENT) {
    return { text: `[${url} is a ${ctype || "binary"} resource of ${(clen / 1_000_000).toFixed(1)}MB; too large to fetch.]`, title };
  }

  let resp: Response;
  try {
    resp = await fetch(url, { signal, headers: probeHeaders, redirect: "follow" });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  const buf = new Uint8Array(await resp.arrayBuffer());
  if (looksBinary(buf)) {
    return {
      text: `[${url} is a ${ctype || "binary"} download (${(buf.length / 1_000_000).toFixed(2)}MB); not fetched as text.]`,
      title,
    };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return { text, title };
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
    renderCall(args, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      text.setText(
        formatToolCall("web_search", "query", args, theme, ["numberResults"]),
      );
      return text;
    },
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
      "Fetch and return the readable content of one or more URLs. " +
      "Provide `query` to summarize relevant information.",
    promptSnippet:
      "Use to read URLs. Pass `query` to select complete relevant sections server-side.",
    parameters: Type.Object({
      urls: Type.Array(Type.String(), {
        description: "URLs to fetch (max 5)",
      }),
      query: Type.Optional(
        Type.String({
          description:
            "What you're looking for",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
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
          body: JSON.stringify({ urls: toCrawl, query: params.query }),
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
            return { url: reqUrl, text: pf.text, size: pf.text.length };
          }
          const r = byUrl.get(reqUrl);
          if (!r || r.success === false) {
            const err = r?.error_message || "failed to fetch";
            return { url: reqUrl, text: `[Error fetching ${reqUrl}: ${err}]`, size: 0 };
          }
          const md = r.markdown || {};
          const raw =
            md.fit_markdown || md.raw_markdown || r.cleaned_html || "";
          // The gateway owns HTML cleanup, loss-aware query focusing, and
          // inference fallback. This client never summarizes or truncates.
          return { url: reqUrl, text: raw, size: raw.length };
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
