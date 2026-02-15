# AeroSpace Configuration

Tiling window manager configuration using [AeroSpace](https://github.com/nikitabobko/AeroSpace) with sketchybar integration.

## Workspaces

Two categories defined in [`wm-scripts/workspaces.conf`](../wm-scripts/README.md):

- **Letter workspaces** (`1A`, `2Q`, `3W`, `4T`) — fixed app assignments
- **Numbered workspaces** (`51`–`95`) — dynamically assigned to Zed editor windows

The two-character format uses the first character for sort order and the second as the visible label.

## Key Bindings

- `ctrl-<key>` switches to a workspace
- `ctrl-shift-<key>` moves the focused window to a workspace (with focus follow)
- `ctrl-r` switches to the most recently used numbered workspace
- `ctrl-shift-r` moves the focused window to the most recently used numbered workspace
- `ctrl-left/right` or `ctrl-s/f` to focus left/right within a workspace
- `ctrl-up/down` or `ctrl-e/d` to focus up/down, wrapping to prev/next workspace
- `ctrl-shift-<direction>` to move windows
- `ctrl-x` toggles floating/tiling
- `ctrl-b` toggles h_tiles/h_accordion layout
- `ctrl-f20` workspace back-and-forth

## Dynamic Editor Workspace Assignment

See [wm-scripts README](../wm-scripts/README.md) for full details. The shared scripts in `~/.config/wm-scripts/` handle all editor workspace logic. Aerospace triggers them via:

- `on-window-detected` → `assign-editor-workspace.sh`
- `exec-on-workspace-change` → `track-numbered-ws.sh`
- Keybinds → `update-editor-mapping.sh`, `last-numbered-ws.sh`

## Static App Assignments

| App | Workspace |
|-----|-----------|
| Zen Browser | `1A` |
| Google Chrome | `2Q` |
| VS Code, WebStorm, Cursor | `62` |
| Discord, Slack, Messenger | `4T` |

Zen browser extension windows and Finder windows float. Zed settings windows float.

## PiP Follow (`pip-move.sh`)

Picture-in-Picture and Google Meet windows are set to float and follow you to whichever workspace you switch to. Triggered on every workspace change via `exec-on-workspace-change`. This is macOS-only (on niri, PiP is pinned to the secondary monitor instead).
