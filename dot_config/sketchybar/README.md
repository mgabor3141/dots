# Sketchybar Config

Originally based on: https://github.com/OthinusG/mac-dotfiles/tree/main

## Useful Commands

```console
# View logs
log show --last 10m --predicate 'process == "sketchybar"' --style compact

# Restart (launchctl auto-restarts it)
launchctl stop io.github.felixkratz.SketchyBar

# Query an item's state
sketchybar --query space.1A
```

## Architecture: Workspace Labels

The bar shows aerospace workspaces on the left. Each workspace item (`space.<id>`) displays a highlight (background color when focused) and a label (app icons or Zed project name).

### Workspaces

Defined in `~/.config/aerospace/workspaces.conf` (shared with aerospace scripts):

- **Letter workspaces**: `1A`, `2W`, `3R`, `4T` — general purpose, labels show app icons from `sketchybar-app-font`
- **Numbered workspaces**: `51`, `62`, `73`, `84`, `95` — for code editors (Zed), labels show shortest unique prefix of project name as text

Empty workspaces are hidden unless focused.

### Event Flow

Aerospace fires `exec-on-workspace-change` on every workspace switch, which triggers the custom `aerospace_workspace_change` sketchybar event with `FOCUSED_WORKSPACE` and `PREV_WORKSPACE` env vars.

All workspace label and highlight logic lives in `plugins/space_windows.sh`, attached to `space_separator` (a dummy item). It is also called directly at startup by `items/spaces.sh`. The per-item `plugins/aerospace.sh` only handles mouse hover effects.

### Fast Path vs Full Refresh

`space_windows.sh` has two code paths — this is the core design decision for performance:

- **Fast path** (`aerospace_workspace_change`): Only updates highlight colors for the focused and previous workspace. Zero aerospace CLI calls. If the previous workspace is empty (detected by querying sketchybar for its current label — the fast path has no window data), it hides it. ~19ms.
- **Full refresh** (all other events): Queries all windows with a single `aerospace list-windows --all`, rebuilds all labels, sets all highlights. One batched sketchybar IPC call. ~65ms.

The fast path works because workspace switching doesn't change labels — only which workspace is highlighted. The `front_app_switched` event that follows ~200ms later triggers a full refresh if anything actually changed (e.g., a window moved).

Letter workspace moves (`ctrl-shift-a/w/r/t`) rely on `exec-on-workspace-change` for the sketchybar update. Only numbered workspace moves (`ctrl-shift-1..5`) additionally run `update-editor-mapping.sh` to persist the mapping.

### Styling

`space_styles.sh` is the single source of truth for all workspace item spacing, fonts, and padding. Both `items/spaces.sh` (creation) and `plugins/space_windows.sh` (updates) source it.

### Performance Constraints

Key decisions that keep things fast:

- Everything is idempotent — no lock files, no timing-based debouncing
- `icon_map_fn.sh` is sourced as a function, not forked per window
- All sketchybar updates are batched into a single IPC call
- Whitespace trimming uses bash builtins, not subshells
- `#!/usr/bin/env bash` is required (not `#!/bin/bash`) — macOS `/bin/bash` is Bash 3.2 which silently breaks `declare -A`
