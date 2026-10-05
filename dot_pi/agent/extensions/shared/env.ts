/**
 * One place that answers "what is this configuration value" for extensions needing something pi
 * does not manage for them, such as a search endpoint or a model ladder for a delegated call.
 *
 * The shell environment wins, then ~/.env, which is where chezmoi keeps these for machines whose
 * shell exports nothing, PowerShell on Windows being the case that matters. Keys here are
 * configuration, not model-provider credentials: those belong in auth.json and are resolved by pi
 * through ctx.modelRegistry.getApiKeyForProvider, never from here.
 *
 * Lives in a subdirectory on purpose. pi loads every direct *.ts file in extensions/ as an
 * extension, so a shared module must not sit at the top level.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let dotenvCache: Record<string, string> | undefined;

function dotenvValues(): Record<string, string> {
  if (dotenvCache) return dotenvCache;
  const values: Record<string, string> = {};
  const file = join(homedir(), ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim(); // also removes the \r a CRLF file leaves behind
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Split on the first "=" only: a token is often base64 and ends in "=", and a URL can carry
      // "=" in a query. Splitting on every "=" truncates both.
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (key && value) values[key] = value;
    }
  }
  dotenvCache = values;
  return values;
}

/** Environment first, ~/.env second, `fallback` when neither supplies a value. */
export function configValue(key: string, fallback: string): string;
export function configValue(key: string): string | undefined;
export function configValue(key: string, fallback?: string): string | undefined {
  return process.env[key]?.trim() || dotenvValues()[key] || fallback;
}
