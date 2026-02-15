[Niri docs](https://yalter.github.io/niri/)

## Workspaces

**Static workspaces** (`A`, `Q`, `W`, `T`) are declared in `config.kdl` with fixed app assignments via window rules. `T` (chat) is on the secondary monitor; the rest are on the primary.

**Dynamic editor workspaces** (`1-dots`, `2-go60`, etc.) are created on demand by the event daemon when Zed windows open. They use a `N-label` naming convention where N is the slot number and the label is a shortest-unique-prefix of the project name. No upper slot limit — `Mod+1`–`5` give direct access to the first five, but directional (`Mod+Shift+E/D`) and MRU (`Mod+R`) work for any slot. Empty editor workspaces are automatically deleted.

Empty workspaces are skipped during `Mod+E`/`Mod+D` focus navigation (`skip-empty-workspace.sh`). Direct access via `Mod+1`–`5` and `Mod+A`/`Q`/`W`/`T` always works.

## Keybinds

| Bind | Action |
|------|--------|
| `Mod+1`–`5` | Focus dynamic workspace by slot (`numbered-ws.sh focus N`) |
| `Mod+Shift+1`–`5` | Move column to slot, creating workspace if needed (`numbered-ws.sh move N`) |
| `Mod+Shift+E/D` | Move column up/down through dynamic slots (`move-column-dynamic.sh`) |
| `Mod+E/D` | Focus next non-empty workspace up/down (`skip-empty-workspace.sh`) |
| `Mod+R` | Focus MRU numbered workspace (`last-numbered-ws.sh switch`) |
| `Mod+A/Q/W/T` | Focus static workspace |
| `Mod+Shift+A/Q/W/T` | Move column to static workspace |

### Dynamic move behavior (`Mod+Shift+E/D`)

On a dynamic workspace, moves through slots with arithmetic (N±1). If the target slot exists, the column merges into it. If not, a new workspace is created at that slot. The daemon handles renaming, state updates, and cleanup of the now-empty source workspace. No-ops at slot 1 (lower bound); no upper bound. On a static workspace, falls through to native niri `move-column-to-workspace-up/down`.

### Letter workspace moves

Moving a Zed window to a static workspace (A/Q/W/T) does not update the state file. The previous slot mapping is preserved, so the window returns to its numbered slot on next Zed restart.

## Event Daemon

`event-daemon.sh` watches niri's IPC event stream and manages Zed editor workspaces:

- **Window open**: Assigns to saved slot (from state file) or first free slot, creates the workspace, names it, sorts it after static workspaces, and nudges the window (1px resize to fix a Zed rendering bug on niri)
- **SSH-pending windows**: Windows that start with title "empty project" (waiting for SSH) are nudged immediately but assignment is deferred. The daemon tracks them as pending and picks them up via `WindowsChanged` events once the title resolves to a real project name
- **Manual move**: Detects workspace_id changes and updates the state file (numbered slots only). Deletes the old workspace if it's now empty of Zed windows
- **Window close**: Deletes workspace if no Zed windows remain on it
- **Label stability**: When multiple Zed windows share a workspace, the label reflects whichever window arrived first. The label only changes when that window leaves
- **Label refresh**: Recomputes shortest-unique-prefix labels when projects are added/removed

Started via `spawn-at-startup` in `config.kdl`. Log at `/tmp/niri-event-daemon.log`.

### Niri event stream gotchas

- `WindowOpenedOrChanged` fires on window open and workspace moves, but **not** on title changes
- Title changes fire `WindowsChanged` (a full window list dump) — the daemon only processes this when pending windows exist, to avoid unnecessary work
- Empty associative arrays are treated as unbound by `set -u` in bash; the daemon initializes them with a dummy key workaround

See [wm-scripts README](../wm-scripts/README.md) for the state file and cross-platform details.

## Useful commands

```sh
niri msg windows      # List all windows (add -j for JSON)
niri msg workspaces   # List all workspaces
niri msg event-stream # Watch live events (add -j for JSON)
tail -f /tmp/niri-event-daemon.log  # Daemon log
```
