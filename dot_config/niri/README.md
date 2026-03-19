[Niri docs](https://yalter.github.io/niri/)

## Workspaces

**Static workspaces** are all declared in `config.kdl` with fixed output assignments:

| Key | Name | Output | Purpose |
|-----|------|--------|---------|
| A | `A` | Primary | Browser |
| Q | `Q` | Primary | Browser 2 |
| W | `W` | Primary | Misc / Steam |
| 1–5 | `e1`–`e5` | Primary | Editor (Zed) |
| T | `T` | Secondary | Chat |

Empty workspaces are skipped during `Mod+E`/`Mod+D` focus navigation (`skip-empty-workspace.sh`). Direct access via `Mod+1`–`5` and `Mod+A`/`Q`/`W`/`T` always works (native keybinds).

## Keybinds

| Bind | Action |
|------|--------|
| `Mod+1`–`5` | Focus workspace e1–e5 (native) |
| `Mod+Shift+1`–`5` | Move column to workspace e1–e5 (native) |
| `Mod+Shift+E/D` | Move column to workspace up/down (native) |
| `Mod+E/D` | Focus next non-empty workspace up/down (`skip-empty-workspace.sh`) |
| `Mod+R` | Focus MRU numbered workspace (`last-numbered-ws.sh switch`) |
| `Mod+A/Q/W/T` | Focus static workspace (native) |
| `Mod+Shift+A/Q/W/T` | Move column to static workspace (native) |

## Event Daemon

`event-daemon.sh` watches niri's IPC event stream and auto-places Zed editor windows on numbered workspaces (e1–e5):

- **Window open**: Looks up project name in state file → moves window to saved workspace, or assigns first free one
- **SSH-pending windows**: Windows starting with "empty project" title are tracked and placed once their real title resolves
- **Manual move**: Detects workspace changes and updates the state file
- **Window close**: Cleans up internal tracking (workspaces persist since they're static)

Started via `spawn-at-startup` in `config.kdl`. Log at `/tmp/niri-event-daemon.log`.

### State file

`~/.config/wm-scripts/editor-workspaces.json` maps project names to workspace names:

```json
{"chezmoi": "e1", "go60": "e3"}
```

Mappings persist across Zed restarts so projects return to the same workspace.

## Useful commands

```sh
niri msg windows      # List all windows (add -j for JSON)
niri msg workspaces   # List all workspaces
niri msg event-stream # Watch live events (add -j for JSON)
tail -f /tmp/niri-event-daemon.log  # Daemon log
```
