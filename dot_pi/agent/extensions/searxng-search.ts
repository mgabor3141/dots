import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const BASE_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const TOKEN = process.env.SEARXNG_TOKEN ?? null;

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
      // Retry on 5xx or 429 rate-limit
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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "searxng_search",
    label: "SearXNG Search",
    description:
      "Search the web via a local SearXNG instance. Returns results with title, URL, and snippet. " +
      "Use for web research questions.",
    promptSnippet:
      "Use for web research questions. Returns numbered list of title/URL/snippet results.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numberResults: Type.Optional(
        Type.Number({ description: "Number of results (default 10, max 20)" })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const url = new URL("/search", BASE_URL);
      url.searchParams.set("q", params.query);
      url.searchParams.set("format", "json");
      const n = Math.min(params.numberResults ?? 10, 20);
      url.searchParams.set("number_of_results", String(n));

      const headers: Record<string, string> = {};
      if (TOKEN !== null) headers["Authorization"] = `Bearer ${TOKEN}`;

      const response = await fetchWithRetry(url.toString(), { signal, headers }, 3);
      if (!response.ok) {
        throw new Error(`SearXNG error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const results = ((data.results || []) as any[]).map((r: any, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`
      );

      return {
        content: [{ type: "text", text: results.join("\n\n") || "No results found." }],
        details: { resultCount: results.length },
      };
    },
  });
}
