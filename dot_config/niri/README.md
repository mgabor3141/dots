[Niri docs](https://yalter.github.io/niri/)

## Workspaces

**Static workspaces** (`A`, `Q`, `W`, `T`) are declared in `config.kdl` with fixed app assignments via window rules. `T` (chat) is on the secondary monitor; the rest are on the primary.

**Dynamic editor workspaces** (`1-dots`, `2-go60`, etc.) are created on demand by the event daemon when Zed windows open. They use a `N-label` naming convention where N is the slot number (1–5) and the label is a shortest-unique-prefix of the project name. Empty editor workspaces are automatically deleted.

Empty workspaces are skipped during `Mod+E`/`Mod+D` navigation (`skip-empty-workspace.sh`). Direct access via `Mod+1`–`5` and `Mod+A`/`Q`/`W`/`T` always works.

## Event Daemon

`event-daemon.sh` watches niri's IPC event stream and manages Zed editor workspaces:

- **Window open**: Assigns to saved slot (from state file) or first free slot, creates the workspace, names it, sorts it after static workspaces, and nudges the window (1px resize to fix a Zed rendering bug)
- **Manual move**: Detects workspace_id changes and updates the state file. Deletes the old workspace if it's now empty of Zed windows
- **Window close**: Deletes workspace if no Zed windows remain on it
- **Label refresh**: Recomputes shortest-unique-prefix labels when projects are added/removed

Started via `spawn-at-startup` in `config.kdl`. Each window is processed exactly once (SEEN tracking).

See [wm-scripts README](../wm-scripts/README.md) for the state file and cross-platform details.

## Useful commands

```sh
niri msg windows      # List all windows (add -j for JSON)
niri msg workspaces   # List all workspaces
niri msg event-stream # Watch live events (add -j for JSON)
tail -f /tmp/niri-event-daemon.log  # Daemon log
```
