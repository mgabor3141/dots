---
name: grove
description: Create isolated jj workspaces for parallel work, agent tasks, or experiments. Workspaces live at .grove/<name>/ and share configured files via symlinks. Use when a task needs a clean filesystem separate from the current working copy.
---

`grove` creates jj workspaces at `.grove/<name>/`: isolated working copies of the repo with shared files (`.pi`, `AGENTS.md`, etc.) symlinked in per `.grove/grove.toml`.

## Create a workspace

```bash
grove new --no-editor -y <name>
cd .grove/<name>
```

`--no-editor` suppresses the configured editor; `-y` skips the init prompt on first use in a project.

## Other commands

```bash
grove status              # project overview: repos, workspaces, ahead/behind
grove refresh [name]      # rebase a workspace onto trunk; --all for every workspace
grove delete <name>       # delete a workspace
grove clean               # delete workspaces with no commits or changes
```

## Gotcha

Untracked files (gitignored, including `.memory/` and `*.local.md`) live only in the workspace that created them. If you write per-workspace docs, write them inside the workspace.
