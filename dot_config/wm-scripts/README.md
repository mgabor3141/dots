# Shared Window Management Scripts

Cross-platform scripts for dynamic editor workspace assignment, shared between [AeroSpace](../aerospace/README.md) (macOS) and [niri](../niri/README.md) (Linux).

## Architecture

`wm-backend.sh` auto-detects the running window manager and provides a common interface. All other scripts source it and use `wm_*` functions instead of calling WM-specific commands directly.

The backend provides: `wm_list_editor_windows`, `wm_list_occupied_workspaces`, `wm_move_window`, `wm_focused_window`, `wm_focused_workspace`, `wm_switch_workspace`, `wm_move_focused_window`, `wm_post_move_hook`, and `wm_mru_numbered_workspace`.

## Workspace Naming

Workspace names differ per WM but map to the same keys. `workspaces.conf` is a chezmoi template that renders the right names per OS.

| Key | Aerospace (macOS) | Niri (Linux) | Purpose |
|-----|-------------------|--------------|---------|
| A | `1A` | `A` | Browser |
| Q | `2Q` | `Q` | Browser 2 |
| W | `3W` | `W` | Misc |
| T | `4T` | `T` | Chat (secondary monitor) |
| 1–5 | `51`–`95` | `1e`–`5e` | Editor (dynamic assignment) |

Aerospace needs two-char names for alphabetical sort ordering. Niri sorts by declaration order in config, but uses `1e`–`5e` (not plain `1`–`5`) because niri's IPC treats purely numeric workspace references as indices, not names.

All workspaces are declared statically in both WMs. Empty workspaces are skipped during up/down navigation on niri (see `skip-empty-workspace.sh`).

## How Dynamic Editor Assignment Works

Zed editor windows are automatically assigned to numbered workspaces. The system has two halves:

1. **Auto-assignment** (`assign-editor-workspace.sh`): Scans all Zed windows and moves any that aren't on their correct workspace. Checks `editor-workspaces.json` for saved mappings. Unmapped projects go to the first empty numbered workspace (fallback: last numbered). This script is read-only — it never writes to the state file.

2. **Manual pinning** (`update-editor-mapping.sh`): When you manually move a window to a numbered workspace (e.g., `Mod+Shift+1`), the mapping is saved. Only manual moves create persistent mappings, so throwaway windows don't pollute the state file.

Triggering differs by WM:
- **Aerospace**: `on-window-detected` callback calls `assign-editor-workspace.sh` directly
- **Niri**: `event-daemon.sh` watches the event stream for `WindowOpenedOrChanged` events from Zed

## MRU Numbered Workspace

`last-numbered-ws.sh` resolves the most recently used numbered workspace (excluding current) for quick switching (`Mod+R`) or moving (`Mod+Shift+R`).

- **Niri**: Derived on-the-fly from window `focus_timestamp` via IPC — no state file needed
- **Aerospace**: Tracked in `/tmp/wm-numbered-mru` by `track-numbered-ws.sh` (called from `exec-on-workspace-change`)

## Skip-Empty Navigation (niri only)

`skip-empty-workspace.sh` navigates up/down to the next workspace that has windows, skipping empty ones. This keeps navigation snappy despite having 9 statically declared workspaces. Bound to `Mod+E`/`Mod+D` in niri. Falls back to native `focus-workspace-up/down` if no non-empty workspace is found.

## State File

`editor-workspaces.json` stores project→workspace mappings. Not tracked by chezmoi (listed in `.chezmoiignore`).

```json
{ "my-project": "51", "other-project": "62" }
```

Workspace values use WM-specific names (e.g. `51` on aerospace, `1e` on niri). Mappings use hyphen-delimited prefix matching (`my-project` matches `my-project-subdir` and vice versa). To reset: `echo '{}' > ~/.config/wm-scripts/editor-workspaces.json`
