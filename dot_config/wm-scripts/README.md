# Window Management Scripts

Helper scripts for workspace navigation, shared across platforms.

## Scripts

| Script | Purpose | Used by |
|--------|---------|---------|
| `wm-backend.sh` | WM abstraction layer (niri) | Other scripts |
| `skip-empty-workspace.sh` | Focus next non-empty workspace up/down | Niri keybinds (`Mod+E/D`) |
| `last-numbered-ws.sh` | Switch to or move to MRU numbered workspace | Niri keybinds (`Mod+R`, `Mod+Shift+R`) |
| `screenrec.sh` | Screen recording toggle | Niri keybinds |

## MRU Numbered Workspace

`last-numbered-ws.sh` resolves the most recently used numbered workspace (1–5, excluding current) for quick switching (`Mod+R`). MRU is derived from window `focus_timestamp` via niri IPC.

## State File

`editor-workspaces.json` maps Zed project names to workspace names. Managed by the [event daemon](../niri/README.md#event-daemon), not by these scripts.

```json
{"chezmoi": "e1", "go60": "e3"}
```
