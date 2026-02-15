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

## Scripts

| Script | Purpose | Used by |
|--------|---------|---------|
| `wm-backend.sh` | WM abstraction layer, auto-detects niri/aerospace | All scripts |
| `numbered-ws.sh` | Focus or move column to a slot by number | Niri keybinds (`Mod+1-5`, `Mod+Shift+1-5`) |
| `move-column-dynamic.sh` | Move column up/down through slots with arithmetic | Niri keybinds (`Mod+Shift+E/D`) |
| `skip-empty-workspace.sh` | Focus next non-empty workspace up/down | Niri keybinds (`Mod+E/D`) |
| `last-numbered-ws.sh` | Switch to or move to MRU numbered workspace | Both (`Mod+R`) |
| `assign-editor-workspace.sh` | Auto-assign Zed window to a slot | Aerospace `on-window-detected` |
| `update-editor-mapping.sh` | Save manual workspace pinning | Aerospace move keybinds |
| `track-numbered-ws.sh` | Track MRU workspace to file | Aerospace `exec-on-workspace-change` |

## How Dynamic Editor Assignment Works

Zed editor windows are automatically assigned to numbered workspace slots. The system works differently on each platform:

**Niri**: The event daemon (`event-daemon.sh`) handles everything — assignment, workspace creation/deletion, naming, sorting, and state updates. It watches the event stream for window events. Each window is processed exactly once. Moves between dynamic slots (via keybinds or drag) are detected via workspace_id changes and the state file is updated automatically. Moves to static workspaces are ignored (state preserved for the old slot).

**Aerospace**: `on-window-detected` callback calls `assign-editor-workspace.sh` for auto-assignment. `update-editor-mapping.sh` is called from move keybinds to save manual pinning.

## MRU Numbered Workspace

`last-numbered-ws.sh` resolves the most recently used numbered workspace (excluding current) for quick switching (`Mod+R`).

- **Niri**: Derived on-the-fly from window `focus_timestamp` — matches dynamic `N-*` workspace names
- **Aerospace**: Tracked in `/tmp/wm-numbered-mru` by `track-numbered-ws.sh`

## State File

`editor-workspaces.json` maps project names to slot numbers. Not tracked by chezmoi.

```json
{ "chezmoi": 1, "go60-zmk-config": 4 }
```

Mappings persist across Zed restarts so projects return to the same slots. Moving a Zed window to a static workspace does not update state — the old slot mapping is preserved. To reset: `echo '{}' > ~/.config/wm-scripts/editor-workspaces.json`
