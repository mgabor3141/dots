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

- **Letter workspaces**: `1A`, `2W`, `3R`, `4T` — general purpose, labels show app icons
- **Numbered workspaces**: `51`, `62`, `73`, `84`, `95` — for code editors (Zed), labels show project names as text

### Event Flow

Aerospace fires `exec-on-workspace-change` on every workspace switch, which triggers the custom `aerospace_workspace_change` sketchybar event with `FOCUSED_WORKSPACE` and `PREV_WORKSPACE` env vars.

**Scripts involved:**

| Script | Purpose | Triggered by |
|---|---|---|
| `plugins/space_windows.sh` | Updates labels and highlight for all workspaces | `aerospace_workspace_change`, `front_app_switched`, `space_windows_change`, `aerospace_node_moved`, `system_woke` |
| `plugins/aerospace.sh` | Mouse hover highlight per workspace item | `mouse.entered`, `mouse.exited` (subscribed per-item) |

### Label Types

- **Icon labels**: App icons from `sketchybar-app-font`, mapped by `plugins/icon_map_fn.sh`. Used for letter workspaces and numbered workspaces without Zed.
- **Text labels**: Shortest unique prefix of the Zed project name (e.g., "core" for "core-apps" if unambiguous). The alias "chezmoi" → "dots" is hardcoded.

### Fast Path vs Full Refresh

`space_windows.sh` has two code paths:

- **Fast path** (`aerospace_workspace_change`): Only updates highlight colors for the focused and previous workspace. Zero aerospace CLI calls, one batched sketchybar call (~19ms). If the previous workspace is empty (detected by querying its sketchybar label), it's hidden with `drawing=off`.
- **Full refresh** (all other events): Queries all windows via `aerospace list-windows --all`, rebuilds labels, and updates everything in one batched sketchybar call (~65ms).

### Empty Workspace Behavior

- Empty + focused: shown with no label (just the workspace icon)
- Empty + unfocused: hidden (`drawing=off`)

### Styling

`space_styles.sh` is the single source of truth for all workspace item spacing, fonts, and padding. Both `items/spaces.sh` (creation) and `plugins/space_windows.sh` (updates) source it.

### Performance Considerations

- `space_windows.sh` uses `#!/usr/bin/env bash` to get Bash 5 (needed for associative arrays). macOS `/bin/bash` is Bash 3.2 which silently breaks `declare -A`.
- `icon_map_fn.sh` is sourced as a function (not forked per window) to avoid subshell overhead.
- All `sketchybar --set` calls are batched into a single IPC invocation.
- A single `aerospace list-windows --all` call replaces per-workspace queries.
- Zed project label computation (shortest unique prefix) is inlined rather than calling a separate script.

### Custom Events

| Event | Registered in | Triggered by |
|---|---|---|
| `aerospace_workspace_change` | `items/spaces.sh` | aerospace `exec-on-workspace-change` |
| `aerospace_mode_change` | `defaults.sh` | (reserved for future aerospace mode switching) |
| `aerospace_monitor_change` | `items/spaces.sh` | (reserved for future monitor change handling) |
| `aerospace_node_moved` | `items/spaces.sh` | `assign-editor-workspace.sh` (batch Zed window assignment) |
