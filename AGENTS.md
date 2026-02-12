# AGENTS.md
**Keep this file very brief.** Only essential context for AI agents working on this repository.
## Repository Overview
This is a **public** dotfiles repository managed by chezmoi. It supports multiple platforms (macOS/darwin and Linux) with conditional file management.
**Privacy:** Do not include personal information, machine names, serial numbers, or other identifying details in files. Keep documentation general and useful for others.
## Agent Instructions
1. **Read README files first.** Before working in any subdirectory, check for a README.md and read it. These contain domain-specific context, design principles, and gotchas.
2. **Sub-project documentation belongs in README files**, not here. When adding documentation about a specific tool or config area, write it in a README.md within that subdirectory and link to it from here. Keep this file as a high-level index.
3. **Open temporary files for the user.** When creating temporary files intended for the user to read, run `zed <filepath>` after writing them so they open automatically.
4. **Keep documentation up to date.** When you discover information that isn't documented but would be useful for future sessions (gotchas, design decisions, how things work), update the relevant README or this file.
## Key Gotchas
1. **External files/repositories**: Some files are managed using `.chezmoiexternal.toml` files (e.g., fish plugins at `dot_config/fish/.chezmoiexternal.toml`). Don't manually add these files to the repo - update the external config instead.
2. **Platform-specific files**: Files/folders specific to Linux or macOS are conditionally ignored via `.chezmoiignore` based on `chezmoi.os`. Check the ignore file before assuming something should exist.
3. **Template files**: Files ending in `.tmpl` are chezmoi templates that get processed. Don't edit the target files directly - edit the source templates. **IMPORTANT**: When searching for config files, always search for both the regular extension AND the `.tmpl` extension (e.g., search for both `keymap.json` and `keymap.json.tmpl`).
4. **Ignore files**: Prefer subfolder-specific `.chezmoiignore` files over the global `.chezmoiignore` file. This keeps ignore rules localized and easier to maintain.
5. **Always check diffs first**: Before applying changes, run `chezmoi diff` to see what would be changed. Then use `chezmoi apply` to apply changes. You do not need to verify that `chezmoi apply` successfully updated the target files - trust that it worked.
6. **macOS `/bin/bash` is Bash 3.2**: It lacks features like associative arrays (`declare -A`), which silently break. Scripts needing Bash 4+ features must use `#!/usr/bin/env bash` (not `#!/bin/bash`) so they pick up the Homebrew-installed Bash 5. On Linux this is not an issue since the system bash is already 5+.
## Sub-project READMEs
- dot_config/aerospace/README.md
- dot_config/kanata/README.md
- dot_config/zed/README.md
- dot_config/sketchybar/README.md
- dot_config/niri/README.md
- dot_config/autostart/README.md
- dot_config/customizepkg/README.md
- dot_config/org.coolercontrol.CoolerControl/README.md
- dot_hammerspoon/README.md
- pacman/README.md
- private_Library/Keyboard Layouts/README.md
- private_Library/private_Preferences/README.md
