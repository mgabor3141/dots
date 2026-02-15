# Shared Window Management Scripts

Cross-platform scripts for dynamic editor workspace assignment, shared between [AeroSpace](../aerospace/README.md) (macOS) and [niri](../niri/README.md) (Linux).

## Architecture

`wm-backend.sh` auto-detects the running window manager and provides a common interface. All other scripts source it and use `wm_*` functions instead of calling WM-specific commands directly.

## Workspace Naming

| Key | Aerospace (macOS) | Niri (Linux) | Purpose |
|-----|-------------------|--------------|---------|
| A | `1A` | `A` | Browser |
| Q | `2Q` | `Q` | Browser 2 |
| W | `3W` | `W` | Misc / Steam |
| T | `4T` | `T` | Chat (secondary monitor) |
| 1–5 | `51`–`95` | `1-label`–`5-label` | Editor (dynamic) |

Aerospace uses two-char names for alphabetical sort ordering, and declares all workspaces statically. Niri declares only static workspaces (A, Q, W, T) in config; editor workspaces are created dynamically by the event daemon with names like `1-dots`, `2-go60` (slot number + shortest-unique-prefix label).

## How Dynamic Editor Assignment Works

Zed editor windows are automatically assigned to numbered workspace slots (1–5). The system works differently on each platform:

**Niri**: The event daemon (`event-daemon.sh`) handles everything — assignment, workspace creation/deletion, naming, sorting, and state updates. It watches the event stream for `WindowOpenedOrChanged` and `WindowClosed` events. Each window is processed exactly once. Manual moves (via keybinds or drag) are detected via workspace_id changes and the state file is updated automatically.

**Aerospace**: `on-window-detected` callback calls `assign-editor-workspace.sh` for auto-assignment. `update-editor-mapping.sh` is called from move keybinds to save manual pinning.

## MRU Numbered Workspace

`last-numbered-ws.sh` resolves the most recently used numbered workspace (excluding current) for quick switching (`Mod+R`) or moving (`Mod+Shift+R`).

- **Niri**: Derived on-the-fly from window `focus_timestamp` — matches dynamic `N-*` workspace names
- **Aerospace**: Tracked in `/tmp/wm-numbered-mru` by `track-numbered-ws.sh`

## State File

`editor-workspaces.json` maps project names to slot numbers. Not tracked by chezmoi.

```json
{ "chezmoi": 1, "go60-zmk-config": 2 }
```

On niri, slot numbers (1–5) map to dynamic workspace names (`1-label`). On aerospace, the values are workspace names (`51`–`95`). Mappings persist across Zed restarts so projects return to the same slots. To reset: `echo '{}' > ~/.config/wm-scripts/editor-workspaces.json`
