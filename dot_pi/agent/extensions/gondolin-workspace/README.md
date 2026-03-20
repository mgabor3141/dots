# Gondolin Workspace Extension

Pi extension that sandboxes agent execution inside a Gondolin micro-VM for grove workspaces.
No-op when not inside a grove (no `.grove.toml` found) or when no `[sandbox]` config is present.

## How it works

```
┌─────────────────────────────────────────────────┐
│  Gondolin VM (Alpine Linux, arm64)               │
│                                                   │
│  /workspace ← RealFSProvider mount (bidirectional)│
│  git, gh, jq installed via apk at startup         │
│  GH_TOKEN = placeholder (real value never exposed)│
│  GIT_DIR auto-set per repo subdirectory           │
└────────────────────┬──────────────────────────────┘
                     │ HTTP egress
                     ▼
┌─────────────────────────────────────────────────┐
│  Host: Gondolin HTTP proxy                       │
│                                                   │
│  1. isRequestAllowed — policy check (method+path) │
│  2. Secret injection — placeholder → real token   │
│  3. Forward to real API (or block with 403)       │
└─────────────────────────────────────────────────┘
```

All pi tools (bash, read, write, edit) execute inside the VM. The workspace directory is mounted read-write via `RealFSProvider` — file changes are bidirectional between host and guest.

## Configuration

Everything is driven by `.grove.toml` at the grove root:

```toml
[sandbox]
packages = ["git", "github-cli", "jq"]

[sandbox.secrets]
GH_TOKEN = ["api.github.com", "github.com"]
# Values come from the HOST environment, never from this file.
# The VM sees a random placeholder. Gondolin replaces it on the wire
# only for requests to the listed hosts. Cannot be exfiltrated.

[sandbox.network]
allow-hosts = ["api.github.com", "github.com", "*.githubusercontent.com"]

[sandbox.policy.api-github-com]
# Section name = hostname with dots → dashes
GET = ["*"]
POST = ["/graphql", "/repos/*/*/pulls"]
deny = ["/repos/*/*/pulls/*/merge"]
# Anything not matching allow or deny → prompts the user
```

## Critical learnings

- **gh CLI uses GraphQL** (`POST /graphql`) for almost everything. Deny specific REST endpoints instead.
- **`blockInternalRanges: false`** required — GitHub CDN IPs hit Gondolin's internal range filter.
- **`GH_TOKEN` not `GITHUB_TOKEN`** — gh reads `GH_TOKEN`. Export from keyring: `export GH_TOKEN=$(gh auth token)`.
- **VM is Linux, host is macOS** — native npm addons compiled in the VM won't work on the host.
- **`git safe.directory "*"`** required — VM runs as root, mounted files owned by host user.
- **Runtime `apk add`** (~2.7s) is fast enough. Custom image builds need a Zig toolchain.

## Dependencies

Requires QEMU: `brew install qemu` (macOS) or `apt install qemu-system-arm` (Linux arm64).
