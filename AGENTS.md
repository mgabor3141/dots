# AGENTS.md
## Repository Overview
This is a **public** dotfiles repository managed by chezmoi. It supports multiple platforms (macOS/darwin, Linux desktop, headless unraid server) with conditional file management.
**Privacy:** Do not include personal information, machine names, serial numbers, or other identifying details in files.
## Agent Instructions
1. **Read README files first** before working in any subdirectory. They contain domain-specific context, design decisions, and gotchas.
2. **Documentation goes in subdirectory READMEs**, not here. This file is a high-level index only. Cross-cutting discoveries that affect multiple areas go in each relevant README.
3. **Open draft/temporary files** for the user — run `$EDITOR <filepath>` after writing them so they open automatically. This does not apply to files that are in your cwd.
4. **Keep docs up to date.** Document if you had to search, experiment, or were surprised. Don't document what's self-explanatory from the code. The code shows *what*; READMEs capture *why* and *what was learned*.

## Chezmoi Workflow
Edit source files in this repo → `chezmoi diff` → `chezmoi apply` → done. Trust that apply worked; no need to verify target files. Services should either automatically detect their changed config and apply the changes, or `onchange_` scripts are set up to restart them when they need to be.

## Key Gotchas

These apply to almost every task:
1. **Template files (.tmpl)**: Don't edit target files — edit the source templates. **Always search for both the regular extension AND `.tmpl`** (e.g., both `keymap.json` and `keymap.json.tmpl`).
2. **Check diffs before applying**: `chezmoi diff` before `chezmoi apply`, always.
3. **External files**: Some files come from `.chezmoiexternal.toml` (e.g., fish plugins). Update the external config, not the files.
4. **Platform-specific files**: Conditionally ignored via `.chezmoiignore` based on `chezmoi.os` and the `.headless` variable. Check ignore files before assuming something should exist. When creating configuration that applies to only one system, make sure the ignores are set up for the other systems correctly.
5. **Prefer subfolder `.chezmoiignore`** over the global one. Keeps rules localized.
7. **Use chezmoi template variables for paths**: In `.tmpl` files, use `.chezmoi.homeDir`, `.chezmoi.sourceDir`, `.chezmoi.targetFile`, `.chezmoi.sourceFile` and `joinPath` instead of hardcoding paths.

## Shell Scripting
Use `#!/usr/bin/env bash` with `trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR` and `set -Eeuo pipefail` at the top of every script. Don't add redundant `|| exit 1` — let the trap handle failures.
