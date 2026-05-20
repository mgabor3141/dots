/**
 * Self-hosted inference server at inference.mgabor.hu.
 *
 * OpenAI-compatible endpoint with bearer-token auth. Models are discovered
 * dynamically from /v1/models at startup so whatever is loaded on the server
 * shows up in pi without having to edit this file.
 *
 * The API key is read from the MGABOR_INFERENCE_API_KEY env var (set in ~/.env).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://inference.mgabor.hu/v1";
const API_KEY_ENV = "MGABOR_INFERENCE_API_KEY";

function loadDotEnvIfNeeded(name: string): string | undefined {
  if (process.env[name]) return process.env[name];

  const envPath = join(process.env.HOME ?? "", ".env");
  if (!existsSync(envPath)) return undefined;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || match[1] !== name) continue;

    const value = match[2].replace(/^['"]|['"]$/g, "");
    process.env[name] = value;
    return value;
  }

  return undefined;
}

export default async function (pi: ExtensionAPI) {
  const key = loadDotEnvIfNeeded(API_KEY_ENV);
  if (!key) {
    // No key, nothing to register. Avoids a noisy 401 at startup.
    return;
  }

  let modelIds: string[] = [];
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      modelIds = payload.data?.map((m) => m.id) ?? [];
    }
  } catch {
    // Server unreachable at startup. Skip registration so pi doesn't crash.
    return;
  }

  if (modelIds.length === 0) return;

  pi.registerProvider("mgabor", {
    name: "mgabor inference",
    baseUrl: BASE_URL,
    apiKey: API_KEY_ENV,
    api: "openai-completions",
    // Server hosts Qwen3 via vLLM (plus proxy aliases like "best" that route
    // to the same backend), so apply Qwen chat-template thinking to everything.
    models: modelIds.map((id) => ({
      id,
      name: id,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 252000,
      maxTokens: 8192,
      compat: { thinkingFormat: "qwen-chat-template" },
    })),
  });
}
