# AeroSpace Configuration

Tiling window manager configuration using [AeroSpace](https://github.com/nikitabobko/AeroSpace) with sketchybar integration.

## Workspaces

There are two categories of workspaces, defined in `workspaces.conf`:

| Workspace | Hotkey | Purpose |
|-----------|--------|---------|
| `1A` | `ctrl-a` | Browsers (Zen, Chrome) |
| `2W` | `ctrl-w` | Chat (Discord, Slack, Messenger) |
| `3R` | `ctrl-r` | General |
| `4T` | `ctrl-t` | General |
| `51` | `ctrl-1` | Editor (dynamic) |
| `62` | `ctrl-2` | Editor (dynamic) |
| `73` | `ctrl-3` | Editor (dynamic) |
| `84` | `ctrl-4` | Editor (dynamic) |
| `95` | `ctrl-5` | Editor (dynamic) |

Letter workspaces have fixed app assignments. Numbered workspaces are dynamically assigned to editor (Zed) project windows.

The naming convention uses a two-character format where the first character controls sort order and the second is the visible label.

## Key Bindings

- `ctrl-<key>` switches to a workspace
- `ctrl-shift-<key>` moves the focused window to a workspace (with focus follow)
- `ctrl-left/right` or `ctrl-s/f` to focus left/right within a workspace
- `ctrl-up/down` or `ctrl-e/d` to focus up/down, wrapping to prev/next workspace
- `ctrl-shift-<direction>` to move windows
- `ctrl-x` toggles floating/tiling
- `ctrl-b` toggles h_tiles/h_accordion layout
- `ctrl-f20` workspace back-and-forth

## Dynamic Editor Workspace Assignment

Zed editor windows are automatically assigned to numbered workspaces when detected. This is handled by two scripts that work together.

### How it works

1. **On window open** (`assign-editor-workspace.sh`): When any Zed window is detected, the script scans *all* Zed windows and moves any that aren't on their correct workspace. It reads the state file to check for saved mappings. If a project has a saved mapping, the window goes to that workspace. If not, it goes to the first empty numbered workspace (falling back to `95`).

2. **On manual move** (`update-editor-mapping.sh`): When you manually move a window to a numbered workspace with `ctrl-shift-1..5`, the mapping is saved to the state file. This pins that project to that workspace for future sessions.

### Design decisions

- **The assign script is read-only** -- it never writes to the state file. Only manual moves create persistent mappings. This means throwaway windows don't pollute the state file, and only projects you care about keeping on a specific workspace get pinned.

- **Idempotent moves** -- the assign script checks each window's current workspace before moving it. Windows already in the right place are skipped. This makes it safe for multiple concurrent invocations (which happens when Zed restores several windows at once on startup).

- **Batch startup handling** -- AeroSpace's `on-window-detected` callback doesn't pass a window ID to the script, so each invocation scans all Zed windows. This handles the case where Zed opens multiple project windows simultaneously on startup.

- **Focus follows last move** -- when multiple windows need moving, only the last move uses `--focus-follows-window`, so you end up on a relevant workspace rather than having focus jump around.

- **Skipped windows** -- settings windows (title "Zed") and empty windows (title "empty project") are ignored by both scripts and will never be saved to the state file.

### State file

`editor-workspaces.json` stores project-to-workspace mappings. It is not tracked by chezmoi (listed in `.chezmoiignore`). Example:

```json
{
  "my-project": "51",
  "other-project": "62"
}
```

Mappings use hyphen-delimited prefix matching, so `my-project` will match a window titled `my-project-subdir` and vice versa.

### Clearing mappings

To reset all editor workspace assignments, delete or empty the state file:

```sh
echo '{}' > ~/.config/aerospace/editor-workspaces.json
```

## Other Behaviors

### Static app assignments

Apps are assigned to fixed workspaces via `on-window-detected` rules:

| App | Workspace |
|-----|-----------|
| Zen Browser | `1A` |
| Google Chrome | `1A` |
| VS Code, WebStorm, Cursor | `62` |
| Discord, Slack, Messenger | `2W` |

Zen browser extension windows and Finder windows float. Zed settings windows float.

### PiP follow (`pip-move.sh`)

Picture-in-Picture and Google Meet windows are set to float and follow you to whichever workspace you switch to. Triggered on every workspace change via `exec-on-workspace-change`.

## Files

| File | Purpose |
|------|---------|
| `aerospace.toml` | Main AeroSpace configuration |
| `workspaces.conf` | Shared workspace definitions sourced by scripts |
| `assign-editor-workspace.sh` | Auto-assigns Zed windows to numbered workspaces (read-only) |
| `update-editor-mapping.sh` | Saves workspace mapping on manual move (write) |
| `pip-move.sh` | Moves PiP/Meet windows to follow focused workspace |
| `editor-workspaces.json` | Runtime state file (not tracked by chezmoi) |
