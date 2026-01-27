# AGENTS.md

**Keep this file very brief.** Only essential context for AI agents working on this repository.

## Repository Overview

This is a dotfiles repository managed by chezmoi. It supports multiple platforms (macOS/darwin and Linux) with conditional file management.

## Key Gotchas

1. **External files/repositories**: Some files are managed using `.chezmoiexternal.toml` files (e.g., fish plugins at `dot_config/fish/.chezmoiexternal.toml`). Don't manually add these files to the repo - update the external config instead.

2. **Platform-specific files**: Files/folders specific to Linux or macOS are conditionally ignored via `.chezmoiignore` based on `chezmoi.os`. Check the ignore file before assuming something should exist.

3. **Template files**: Files ending in `.tmpl` are chezmoi templates that get processed. Don't edit the target files directly - edit the source templates.

4. **Ignore files**: Prefer subfolder-specific `.chezmoiignore` files over the global `.chezmoiignore` file. This keeps ignore rules localized and easier to maintain.

5. **Always check diffs first**: Before applying changes, run `chezmoi diff` to see what would be changed. Then use `chezmoi apply` to apply changes. You do not need to verify that `chezmoi apply` successfully updated the target files - trust that it worked.
