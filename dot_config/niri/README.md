[Niri docs](https://yalter.github.io/niri/)

## Workspaces

All workspaces are declared statically in `config.kdl`. See [`wm-scripts/workspaces.conf`](../wm-scripts/README.md) for the full list.

- **Letter workspaces** (`A`, `Q`, `W`, `T`) — fixed app assignments via window rules
- **Numbered workspaces** (`1e`–`5e`) — dynamically assigned to Zed editor windows

`T` (chat) is on the secondary monitor. All others are on the primary.

Niri's IPC treats purely numeric references as workspace indices, so numbered workspaces use the `1e`–`5e` naming convention instead of plain `1`–`5`.

Empty workspaces are skipped during `Mod+E`/`Mod+D` navigation (`skip-empty-workspace.sh`). Direct access via `Mod+1`–`5` and `Mod+A`/`Q`/`W`/`T` always works regardless.

## Event Daemon

`event-daemon.sh` watches niri's IPC event stream for Zed `WindowOpenedOrChanged` events and dispatches to the shared `assign-editor-workspace.sh` script. Started via `spawn-sh-at-startup` in `config.kdl`. Includes a startup retry loop to wait for the IPC socket.

See [wm-scripts README](../wm-scripts/README.md) for full details on editor assignment.

## Useful commands

```sh
niri msg windows      # List all windows (add -j for JSON)
niri msg workspaces   # List all workspaces
niri msg event-stream # Watch live events (add -j for JSON)
```
