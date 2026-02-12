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
| `plugins/space_windows.sh` | Updates labels and highlight for all workspaces | `aerospace_workspace_change`, `front_app_switched`, `space_windows_change`, `aerospace_node_moved`, `system_woke`, and directly at startup |
| `plugins/aerospace.sh` | Mouse hover highlight per workspace item | `mouse.entered`, `mouse.exited` (subscribed per-item) |

`space_windows.sh` is attached to `space_separator` (a dummy item) via `--subscribe`. It is also called directly by `items/spaces.sh` at startup (no `SENDER` set) to populate initial labels.

### Label Types

- **Icon labels**: App icons from `sketchybar-app-font`, mapped by `plugins/icon_map_fn.sh`. Used for letter workspaces and numbered workspaces without Zed.
- **Text labels**: Shortest unique prefix of the Zed project name (e.g., "core" for "core-apps" if unambiguous). The alias "chezmoi" → "dots" is hardcoded.

### Fast Path vs Full Refresh

`space_windows.sh` has two code paths:

- **Fast path** (`aerospace_workspace_change`): Only updates highlight colors for the focused and previous workspace. Zero aerospace CLI calls. If the previous workspace is empty (detected by querying sketchybar for its current label value — the fast path has no window data of its own), it's hidden with `drawing=off`. One sketchybar query + one batched set call (~19ms total).
- **Full refresh** (all other events, including startup): Queries all windows via a single `aerospace list-windows --all` call, rebuilds all labels, and sets highlight colors. Everything is batched into one sketchybar IPC call (~65ms total).

Letter workspace moves (`ctrl-shift-a/w/r/t`) don't fire `aerospace_node_moved` — the `exec-on-workspace-change` that fires from focus-follows-window is sufficient. Only numbered workspace moves (`ctrl-shift-1..5`) run `update-editor-mapping.sh` to save the mapping.

### Empty Workspace Behavior

- Empty + focused: shown with no label (just the workspace icon)
- Empty + unfocused: hidden (`drawing=off`)

### Styling

`space_styles.sh` is the single source of truth for all workspace item spacing, fonts, and padding. Both `items/spaces.sh` (creation) and `plugins/space_windows.sh` (updates) source it.

### Performance Considerations

- `space_windows.sh` uses `#!/usr/bin/env bash` to get Bash 5 (needed for associative arrays). macOS `/bin/bash` is Bash 3.2 which silently breaks `declare -A`.
- `icon_map_fn.sh` is loaded via `eval` of the section between `### START-OF-ICON-MAP` and `### END-OF-ICON-MAP` markers — this defines the `icon_map` function in the current shell (only done in the full refresh path, not the fast path).
- All `sketchybar --set` calls are batched into a single IPC invocation.
- A single `aerospace list-windows --all` call replaces per-workspace queries.
- Zed project label computation (shortest unique prefix) is inlined in `compute_zed_label()` rather than calling `zed_project_label.sh` (which still exists in the repo but is unused by `space_windows.sh`).
- Whitespace trimming in the parse loop uses `read -r` (bash builtin) instead of `echo | xargs` to avoid subshell forks.

### Custom Events

| Event | Registered in | Triggered by |
|---|---|---|
| `aerospace_workspace_change` | `items/spaces.sh` | aerospace `exec-on-workspace-change` |
| `aerospace_mode_change` | `defaults.sh` | (reserved for future aerospace mode switching) |
| `aerospace_monitor_change` | `items/spaces.sh` | aerospace (when implemented); handler sets `display=` on the workspace item |
| `aerospace_node_moved` | `items/spaces.sh` | `assign-editor-workspace.sh` (single trigger after all batch moves) |

### Key Files (workspace system)

| File | Purpose |
|---|---|
| `items/spaces.sh` | Creates `space.<id>` items, registers custom events, calls `space_windows.sh` at startup |
| `plugins/space_windows.sh` | Main workspace script: fast path + full refresh, labels + highlight |
| `plugins/aerospace.sh` | Mouse hover effect only (entered/exited) |
| `plugins/icon_map_fn.sh` | App name → sketchybar-app-font icon mapping (sourced as function) |
| `plugins/zed_project_label.sh` | Standalone Zed label script (unused — logic inlined in `space_windows.sh`) |
| `space_styles.sh` | Spacing, font, and padding constants + `apply_label_style()` |
| `colors.sh` | `$ACCENT_COLOR`, `$BACKGROUND`, `$TRANSPARENT` |
