# npm-global

Declarative management of globally-installed npm packages, similar to how `dot_brew/Brewfile` manages Homebrew packages and `pacman/` manages pacman packages.

## Problem

fnm switches the active Node (and its global `node_modules`) per-project. Tools like `pi` need to always be available regardless of which Node version is active, and they need a consistent `npm` when they call it internally (e.g., pi uses `npm root -g` to manage its extensions).

## How it works

1. **`packages.txt`** — list of npm packages to install globally under fnm's default Node version.
2. **`run_onchange_after_install.sh.tmpl`** — chezmoi script that:
   - Installs/updates packages using fnm default's `npm` directly (bypasses active fnm version)
   - Creates shims in `~/.local/bin/` for each package's binaries
3. **Shims** override `PATH` to pin `node`/`npm` to fnm's default, so tools like `pi` always find the right Node runtime and npm, regardless of which fnm version is active in the shell.

## Usage

Add packages to `packages.txt` (one per line, comments with `#`), then `chezmoi apply`.

To update installed packages to latest versions, touch `packages.txt` (or change its content) and re-apply.

## Requirements

- fnm with a default alias set: `fnm default 22`
- `~/.local/bin` on PATH (should come before fnm's multishell bin)
