/**
 * Gondolin Workspace Extension
 *
 * Sandboxes pi inside a Gondolin micro-VM for grove workspaces.
 * Configuration is read from .grove.toml [sandbox] section.
 *
 * No-op when not inside a grove (no .grove.toml found).
 *
 * Features:
 *   - VM packages installed at startup from [sandbox] packages list
 *   - Secret injection scoped to specific hosts (never exposed to other destinations)
 *   - HTTP policy: structured allow/deny per method+path, prompt on unknown
 *   - GIT_DIR auto-injection per repo subdirectory
 */

import fs from "node:fs";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";

import { VM, RealFSProvider, createHttpHooks } from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";

// ── Grove detection ─────────────────────────────────────────────────

/**
 * Find the grove root by walking up from cwd looking for .grove.toml.
 *
 * Handles three cases:
 *   1. Running from the grove root itself
 *   2. Running from a workspace (.workspaces/<name>/)
 *   3. Running from inside a repo within a workspace
 *
 * Returns null if not inside a grove.
 */
function findGroveRoot(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    if (fs.existsSync(path.join(dir, ".grove.toml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── Config parsing ──────────────────────────────────────────────────

type PolicyRule = { method: string; patterns: string[] };

type SandboxConfig = {
  packages: string[];
  secrets: Record<string, string[]>;
  allowHosts: string[];
  policies: Record<
    string,
    {
      allow: PolicyRule[];
      deny: string[];
      prompt: "unknown" | "none";
    }
  >;
};

function parseGroveToml(filePath: string): SandboxConfig {
  const config: SandboxConfig = {
    packages: [],
    secrets: {},
    allowHosts: [],
    policies: {},
  };

  if (!fs.existsSync(filePath)) return config;

  const text = fs.readFileSync(filePath, "utf8");
  let currentSection = "";
  let currentSubsection = "";

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section headers
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const full = sectionMatch[1].trim();
      if (full.startsWith("sandbox.policy.")) {
        currentSection = "sandbox.policy";
        currentSubsection = full.replace("sandbox.policy.", "");
        config.policies[currentSubsection] = {
          allow: [],
          deny: [],
          prompt: "unknown",
        };
      } else if (full === "sandbox.secrets") {
        currentSection = "sandbox.secrets";
      } else if (full === "sandbox.network") {
        currentSection = "sandbox.network";
      } else if (full === "sandbox") {
        currentSection = "sandbox";
      } else {
        currentSection = full;
        currentSubsection = "";
      }
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim();
    const rawValue = kvMatch[2].trim();

    const parseStringArray = (v: string): string[] => {
      if (v.startsWith("[")) {
        return v
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      return [v.replace(/^["']|["']$/g, "")];
    };

    if (currentSection === "sandbox" && key === "packages") {
      config.packages = parseStringArray(rawValue);
    } else if (currentSection === "sandbox.secrets") {
      config.secrets[key] = parseStringArray(rawValue);
    } else if (
      currentSection === "sandbox.network" &&
      key === "allow-hosts"
    ) {
      config.allowHosts = parseStringArray(rawValue);
    } else if (currentSection === "sandbox.policy") {
      const policy = config.policies[currentSubsection];
      if (key === "deny") {
        policy.deny = parseStringArray(rawValue);
      } else if (key === "prompt") {
        policy.prompt = rawValue.replace(/^["']|["']$/g, "") as
          | "unknown"
          | "none";
      } else {
        policy.allow.push({
          method: key.toUpperCase(),
          patterns: parseStringArray(rawValue),
        });
      }
    }
  }

  return config;
}

// ── HTTP policy engine ──────────────────────────────────────────────

/**
 * Match a URL path against a pattern.
 * "*" matches one path segment. Literal segments match exactly.
 */
function pathMatches(urlPath: string, pattern: string): boolean {
  const pathParts = urlPath.split("/").filter(Boolean);
  const patParts = pattern.split("/").filter(Boolean);

  if (patParts.length === 1 && patParts[0] === "*") return true;

  let pi = 0;
  let pp = 0;
  while (pi < pathParts.length && pp < patParts.length) {
    if (patParts[pp] === "**") return true;
    if (patParts[pp] === "*" || patParts[pp] === pathParts[pi]) {
      pi++;
      pp++;
    } else {
      return false;
    }
  }
  return pi === pathParts.length && pp === patParts.length;
}

/**
 * Normalize a hostname to a policy key.
 * "api.github.com" → "api-github-com"
 */
function hostToPolicyKey(hostname: string): string {
  return hostname.replace(/\./g, "-");
}

type PolicyDecision = "allow" | "deny" | "prompt";

function checkPolicy(
  config: SandboxConfig,
  method: string,
  hostname: string,
  urlPath: string,
): PolicyDecision {
  const policyKey = hostToPolicyKey(hostname);
  const policy = config.policies[policyKey];
  if (!policy) return "prompt";

  // Check deny first
  for (const denyPattern of policy.deny) {
    if (pathMatches(urlPath, denyPattern)) return "deny";
  }

  // Check allow
  for (const rule of policy.allow) {
    if (rule.method === method) {
      for (const pattern of rule.patterns) {
        if (pathMatches(urlPath, pattern)) return "allow";
      }
    }
  }

  return policy.prompt === "unknown" ? "prompt" : "deny";
}

// ── Path helpers ────────────────────────────────────────────────────

function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function toGuestPath(localCwd: string, localPath: string): string {
  const rel = path.relative(localCwd, localPath);
  if (rel === "") return GUEST_WORKSPACE;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${localPath}`);
  }
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

function gitDirPrefix(guestPath: string, repoNames: string[]): string {
  const rel = path.posix.relative(GUEST_WORKSPACE, guestPath);
  const topDir = rel.split("/")[0];
  if (topDir && repoNames.includes(topDir)) {
    return `export GIT_DIR=${GUEST_WORKSPACE}/${topDir}/.git; `;
  }
  return "";
}

// ── Gondolin operations ─────────────────────────────────────────────

function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec(["/bin/cat", guestPath]);
      if (!r.ok) throw new Error(`cat failed (${r.exitCode}): ${r.stderr}`);
      return r.stdoutBuffer;
    },
    access: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec([
        "/bin/sh",
        "-lc",
        `test -r ${shQuote(guestPath)}`,
      ]);
      if (!r.ok) throw new Error(`not readable: ${p}`);
    },
    detectImageMimeType: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      try {
        const r = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!r.ok) return null;
        const m = r.stdout.trim();
        return [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
        ].includes(m)
          ? m
          : null;
      } catch {
        return null;
      }
    },
  };
}

function createGondolinWriteOps(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (p, content) => {
      const guestPath = toGuestPath(localCwd, p);
      const dir = path.posix.dirname(guestPath);
      const b64 = Buffer.from(content).toString("base64");
      const script = [
        "set -eu",
        `mkdir -p ${shQuote(dir)}`,
        `echo ${shQuote(b64)} | base64 -d > ${shQuote(guestPath)}`,
      ].join("\n");
      const r = await vm.exec(["/bin/sh", "-lc", script]);
      if (!r.ok) throw new Error(`write failed (${r.exitCode}): ${r.stderr}`);
    },
    mkdir: async (dir) => {
      const guestDir = toGuestPath(localCwd, dir);
      const r = await vm.exec(["/bin/mkdir", "-p", guestDir]);
      if (!r.ok) throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
    },
  };
}

function createGondolinEditOps(vm: VM, localCwd: string): EditOperations {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function sanitizeEnv(
  env?: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function createGondolinBashOps(
  vm: VM,
  localCwd: string,
  repoNames: string[],
): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = toGuestPath(localCwd, cwd);
      const prefix = gitDirPrefix(guestCwd, repoNames);
      const fullCommand = prefix ? `${prefix}${command}` : command;

      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              ac.abort();
            }, timeout * 1000)
          : undefined;

      try {
        const proc = vm.exec(["/bin/bash", "-lc", fullCommand], {
          cwd: guestCwd,
          signal: ac.signal,
          env: sanitizeEnv(env),
          stdout: "pipe",
          stderr: "pipe",
        });

        for await (const chunk of proc.output()) {
          onData(chunk.data);
        }

        const r = await proc;
        return { exitCode: r.exitCode };
      } catch (err) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

// ── Extension entry point ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const localCwd = process.cwd();
  const groveRoot = findGroveRoot(localCwd);

  // No-op outside groves
  if (!groveRoot) return;

  const groveToml = path.join(groveRoot, ".grove.toml");
  const sandboxConfig = parseGroveToml(groveToml);

  // No sandbox section → no VM needed
  if (
    sandboxConfig.packages.length === 0 &&
    Object.keys(sandboxConfig.secrets).length === 0 &&
    sandboxConfig.allowHosts.length === 0 &&
    Object.keys(sandboxConfig.policies).length === 0
  ) {
    return;
  }

  // Detect repo subdirs
  const repoNames: string[] = [];
  try {
    for (const entry of fs.readdirSync(localCwd, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        fs.existsSync(path.join(localCwd, entry.name, ".jj"))
      ) {
        repoNames.push(entry.name);
      }
    }
  } catch {
    // Not fatal
  }

  // Session-level decision cache for prompted requests
  const promptCache = new Map<string, boolean>();

  function promptCacheKey(
    method: string,
    hostname: string,
    urlPath: string,
  ): string {
    const segments = urlPath.split("/").filter(Boolean).slice(0, 3);
    return `${method}:${hostname}:/${segments.join("/")}`;
  }

  // Baseline local tools
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  let vm: VM | null = null;
  let vmStarting: Promise<VM> | null = null;
  let extensionCtx: ExtensionContext | null = null;

  // Serialise prompts so concurrent requests don't interleave
  let promptQueue: Promise<void> = Promise.resolve();

  async function promptUser(
    method: string,
    hostname: string,
    urlPath: string,
  ): Promise<boolean> {
    const key = promptCacheKey(method, hostname, urlPath);
    const cached = promptCache.get(key);
    if (cached !== undefined) return cached;

    const gate = promptQueue;
    let release!: () => void;
    promptQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await gate;

      const rechecked = promptCache.get(key);
      if (rechecked !== undefined) return rechecked;

      if (!extensionCtx) {
        promptCache.set(key, false);
        return false;
      }

      const allowed = await extensionCtx.ui.confirm(
        "Sandbox: allow HTTP request?",
        `${method} ${hostname}${urlPath}\n\nAllow this and similar requests for this session?`,
      );
      promptCache.set(key, allowed);
      return allowed;
    } finally {
      release();
    }
  }

  async function ensureVm(ctx?: ExtensionContext): Promise<VM> {
    if (vm) return vm;
    if (vmStarting) return vmStarting;

    vmStarting = (async () => {
      if (ctx) extensionCtx = ctx;
      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg("accent", "Gondolin: starting VM…"),
      );

      // Build secrets config from .grove.toml
      const secrets: Record<string, { hosts: string[]; value: string }> = {};
      for (const [envVar, hosts] of Object.entries(sandboxConfig.secrets)) {
        const value = process.env[envVar];
        if (value) {
          secrets[envVar] = { hosts, value };
        }
      }

      // Collect all allowed hosts (explicit + secret hosts)
      const allHosts = new Set(sandboxConfig.allowHosts);
      for (const { hosts } of Object.values(secrets)) {
        for (const h of hosts) allHosts.add(h);
      }
      // Add Alpine package repos for apk
      allHosts.add("dl-cdn.alpinelinux.org");

      const { httpHooks, env: secretEnv } = createHttpHooks({
        allowedHosts: [...allHosts],
        blockInternalRanges: false,
        secrets,
        isRequestAllowed: async (request) => {
          const url = new URL(request.url);
          const hostname = url.hostname;
          const method = request.method;
          const urlPath = url.pathname;

          // Always allow Alpine package manager
          if (hostname === "dl-cdn.alpinelinux.org") return true;

          const decision = checkPolicy(
            sandboxConfig,
            method,
            hostname,
            urlPath,
          );
          if (decision === "allow") return true;
          if (decision === "deny") return false;

          return promptUser(method, hostname, urlPath);
        },
      });

      const created = await VM.create({
        httpHooks,
        env: secretEnv,
        vfs: {
          mounts: {
            [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
          },
        },
      });

      vm = created;

      // Install packages if configured
      if (sandboxConfig.packages.length > 0) {
        ctx?.ui.setStatus(
          "gondolin",
          ctx.ui.theme.fg(
            "accent",
            `Gondolin: installing ${sandboxConfig.packages.join(", ")}…`,
          ),
        );
        const pkgList = sandboxConfig.packages.join(" ");
        const r = await vm.exec([
          "/bin/sh",
          "-lc",
          `apk add --no-cache ${pkgList}`,
        ]);
        if (!r.ok) {
          ctx?.ui.notify(
            `Gondolin: package install failed: ${r.stderr}`,
            "warn",
          );
        }
      }

      // Allow git to work with mounted directories
      // (VM runs as root, host files owned by user)
      await vm.exec([
        "/bin/sh",
        "-lc",
        'git config --global --add safe.directory "*"',
      ]);

      const repoList = repoNames.length
        ? ` (repos: ${repoNames.join(", ")})`
        : "";
      ctx?.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg("accent", `Gondolin: running${repoList}`),
      );
      ctx?.ui.notify(
        `Gondolin VM ready — ${localCwd} mounted at ${GUEST_WORKSPACE}`,
        "info",
      );

      return created;
    })();

    return vmStarting;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    extensionCtx = ctx;
    await ensureVm(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!vm) return;
    ctx.ui.setStatus(
      "gondolin",
      ctx.ui.theme.fg("muted", "Gondolin: stopping"),
    );
    try {
      await vm.close();
    } finally {
      vm = null;
      vmStarting = null;
    }
  });

  // ── Tool overrides ──────────────────────────────────────────────

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      return createReadTool(localCwd, {
        operations: createGondolinReadOps(activeVm, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      return createWriteTool(localCwd, {
        operations: createGondolinWriteOps(activeVm, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      return createEditTool(localCwd, {
        operations: createGondolinEditOps(activeVm, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      return createBashTool(localCwd, {
        operations: createGondolinBashOps(activeVm, localCwd, repoNames),
      }).execute(id, params, signal, onUpdate);
    },
  });

  // ── User ! commands also run inside the VM ──────────────────────

  pi.on("user_bash", (_event) => {
    if (!vm) return;
    return { operations: createGondolinBashOps(vm, localCwd, repoNames) };
  });

  // ── System prompt ───────────────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    await ensureVm();
    let modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (Gondolin sandbox, host: ${localCwd})`,
    );

    if (repoNames.length > 0) {
      const lines = [
        "",
        "This is a sandboxed grove workspace. All commands run inside a Gondolin micro-VM.",
        `Repos: ${repoNames.join(", ")}`,
        "GIT_DIR is set automatically when commands run inside a repo subdirectory.",
        "Secrets (e.g. GH_TOKEN) are available but host-scoped — they only work for requests to their configured hosts.",
        "Network access is restricted to configured hosts. Unrecognized HTTP requests will prompt the user.",
      ];
      modified += lines.join("\n");
    }

    return { systemPrompt: modified };
  });
}
