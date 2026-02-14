---
name: chezmoi
description: >
  Use when creating, editing, or debugging any chezmoi-managed file in this repo.
---

# Chezmoi Conventions in This Repo

Read this skill, then read the referenced files on demand as needed for the task.

## Quick Reference

| Concept | Details |
|---------|---------|
| Source dir | `~/.local/share/chezmoi` (this repo) |
| Apply command | `chezmoi apply <target-path>` |
| Diff before applying | `chezmoi diff <target-path>` |
| Check what's managed | `chezmoi managed \| grep <pattern>` |

## Template Files (.tmpl)

Files ending in `.tmpl` are Go templates processed by chezmoi. Always use template variables for paths:

- `{{ .chezmoi.homeDir }}` — home directory
- `{{ .chezmoi.sourceDir }}` — chezmoi source directory
- `{{ .chezmoi.targetFile }}` — target path of the current file
- `{{ .chezmoi.sourceFile }}` — source path of the current file
- `{{ joinPath .chezmoi.homeDir "somepath" }}` — path construction
- `{{ .chezmoi.targetFile | dir }}` — parent directory of target
- `{{ .chezmoi.sourceFile | dir }}` — parent directory of source

**When searching for config files**, always search for both the plain name AND the `.tmpl` variant
(e.g., both `config.kdl` and `config.kdl.tmpl`).

## Platform-Conditional Ignoring

The `.chezmoiignore` file at the repo root uses chezmoi template conditionals to ignore
platform-specific files. The pattern is:

```
{{- if ne .chezmoi.os "linux" }}
.config/niri
.config/noctalia
.config/systemd
...
{{- end }}

{{- if ne .chezmoi.os "darwin" }}
.config/aerospace
.config/sketchybar
Library
...
{{- end }}
```

Files listed inside the `ne "linux"` block are **only managed on Linux** (ignored elsewhere).
Files inside `ne "darwin"` are **only managed on macOS**.

**Prefer subfolder-specific `.chezmoiignore` files** over adding to the global one when possible.

## Managing System Files Outside $HOME

Chezmoi only manages files under `$HOME`. For system files (e.g., `/etc/sddm.conf`), the pattern is:

1. Keep the source of truth under a chezmoi-managed directory (e.g., `dot_config/sddm/sddm.conf`)
2. Create a `run_onchange_after_*.sh.tmpl` script that copies it to the system location with sudo
3. Embed a hash of the source file so chezmoi re-runs the script when content changes:

```bash
#!/bin/bash
# {{ include (joinPath (.chezmoi.sourceFile | dir) "sddm.conf") | sha256sum }}
sudo cp "{{ joinPath (.chezmoi.targetFile | dir) "sddm.conf" }}" /etc/sddm.conf
```

See `dot_config/sddm/` and `dot_config/kanata/2-daemons/linux/` for working examples.

**Note:** These scripts require sudo, so `chezmoi apply` may prompt for a password.
When running from an agent, use the interactive shell tool to allow the user to enter credentials.

## Naming Conventions

Chezmoi uses filename prefixes to control behavior:

| Prefix | Meaning |
|--------|---------|
| `dot_` | Target filename starts with `.` |
| `run_once_` | Script that runs once ever |
| `run_onchange_` | Script that re-runs when its content changes |
| `run_once_after_` / `run_onchange_after_` | Runs after files are applied |
| `run_onchange_before_` | Runs before files are applied |
| `executable_` | File is made executable |
| `private_` | File gets 0600 permissions |
| `empty_` | File is created even if empty |

## External Files

Some files are pulled from external sources via `.chezmoiexternal.toml` files
(e.g., fish plugins at `dot_config/fish/.chezmoiexternal.toml`).
Don't manually add these files to the repo — update the external config instead.

## Workflow

1. Edit files in the **source directory** (this repo), not the target
2. Run `chezmoi diff` to preview changes
3. Run `chezmoi apply` to apply — trust that it worked, no need to verify target files
