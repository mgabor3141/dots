# npm-global

Declarative management of globally-installed npm packages, similar to how `dot_brew/Brewfile` manages Homebrew packages and `pacman/` manages pacman packages.

## Problem

Tools like `pi` need to always be globally available. On macOS with fnm, the active Node (and its global `node_modules`) switches per-project — globals can disappear. On Linux with a system Node from pacman, this isn't an issue, but we still want a single declarative list of global packages.

## How it works

1. **`packages.txt`** — list of npm packages to install globally.
2. **`run_onchange_after_install.sh.tmpl`** — chezmoi script that detects the Node source and adapts:
   - **fnm mode** (macOS): installs under fnm default's npm, then creates shims in `~/.local/bin/` that pin PATH to fnm default so globals are always available regardless of active fnm version.
   - **system mode** (Linux): installs with the system npm. No shims needed — globals are already on PATH.

## Usage

Add packages to `packages.txt` (one per line, comments with `#`), then `chezmoi apply`.

To update installed packages to latest versions, touch `packages.txt` (or change its content) and re-apply.

## Requirements

- **macOS (fnm):** fnm with a default alias set (`fnm default 22`), `~/.local/bin` on PATH before fnm's multishell bin
- **Linux (system):** Node and npm installed (e.g., `pacman -S nodejs npm`)
