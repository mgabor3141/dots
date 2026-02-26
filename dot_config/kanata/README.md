# Kanata

[Docs](https://jtroo.github.io/config.html)
[Keys](https://github.com/jtroo/kanata/blob/main/parser/src/keys/mod.rs)

Folders are numbered because the scripts are run alphabetically

## Architecture

- **`shared/common.kbd`**: Shared aliases and logic included by all keyboard configs.
- **`shared/chords.kbd`**: Chord definitions (macbook-ansi only currently).
- **`macbook-ansi.kbd`**, **`razer.kbd`**, **`go60.kbd`**: Per-keyboard configs with device matching.
- **`2-daemons/darwin/`**: macOS launchd service and manager script. Polls `hidutil list` to detect connected devices and starts/stops one kanata instance per keyboard as devices appear or disappear (handles BLE keyboards that connect after boot).

### Semantic Modifiers

Two semantic modifier roles are defined in `common.kbd`, with platform-dependent output:

| Alias | Purpose | macOS output | Linux output |
|---|---|---|---|
| `@lsecondary` / `@lse` | App shortcuts (Copy, Paste, etc.) | `lmet` (Cmd) | `lctrl` |
| `@wm-modifier` / `@wm` | Window manager keybinds | `lctl` | `lmet` |

On macOS, `nop0`/`nop1` marker keys and virtual keys (`v-ctrl`/`v-cmd`) handle un-swapping Ctrl/Cmd specifically for Tab (so app/tab switchers work correctly). The `@tab` alias in `common.kbd` contains this logic.

### Design Principles

- **Traditional keyboards stay near-stock.** Only remap what solves a real platform problem (modifier swap, Tab un-swap, caps-to-esc, sleep key, fn layer). Do not import ergonomic keyboard ideas.
- **Go60 remapping is minimal in kanata** — the ZMK firmware handles most of the layout. Kanata only does the modifier swap and Tab un-swap for the Go60.
- **`platform` blocks** can only contain ONE configuration item each.
- **Validate configs** with `kanata --check --cfg <file>` before applying.
- **`defoverrides`** in `common.kbd` normalize Cmd+arrow/Home/End behavior on macOS.

### Validation and Deployment

```sh
kanata --check --cfg dot_config/kanata/1-configs/macbook-ansi.kbd
kanata --check --cfg dot_config/kanata/1-configs/razer.kbd
kanata --check --cfg dot_config/kanata/1-configs/go60.kbd
chezmoi apply ~/.config/kanata/
sudo launchctl kickstart -k system/io.github.jtroo.kanata.manager  # restart service
```

### Related External Config

The Go60 keyboard has its own ZMK firmware config in a separate repository (not managed by chezmoi). The kanata config for the Go60 is intentionally minimal since ZMK handles the layout.

### F13-F24 Key Allocation

F13-F24 are used as an internal signaling bus between firmware, kanata, and application layers. They fall into two categories:

**Direct keys** (F13-F17) — may be pressed by the user or bound directly by applications:

| Key | Usage |
|-----|-------|
| F13 | Global mic mute (physical on Razer, chord elsewhere). Kanata remaps to Hyper+M on macOS. |
| F14-F16 | Razer macro column keys. Currently unassigned (passthrough). |
| F17 | Razer macro column key → Fn layer toggle. |

**Internal synthetic keys** (F18-F24) — never pressed directly; always synthetic events conveying information between remapping layers:

| Key | Usage |
|-----|-------|
| F18 | Kanata substitute for Alt+Left on macOS (frees Alt+Left for word navigation). |
| F19 | Kanata substitute for Alt+Right on macOS (frees Alt+Right for word navigation). |
| F20 | Workspace back-and-forth. Kanata `@wm` tap output → Aerospace (macOS) / niri (Linux). |
| F21 | Sleep. Go60 ZMK firmware sends this alongside C_SLEEP. Kanata remaps to Hyper+S on macOS. |
| F22-F23 | Unassigned. |
| F24 | Razer physical key (right of RAlt) → Fn layer toggle. |

All F13-F24 keysyms are defined in `dot_config/xkb/symbols/mysymbols` for Linux compatibility.

### Robustness & the BLE Flapping Problem

**Problem discovered (Feb 2026):** Each time the manager starts/stops a kanata instance (e.g., Go60 BLE keyboard connecting/disconnecting), the new process initializes the Karabiner DriverKit client, which triggers `connected → driver_connected → virtual_hid_keyboard_ready` callbacks on ALL running kanata instances. The macbook-ansi instance sees a driver disconnection each time, enters recovery (releases keyboard grab, waits for reconnection, re-grabs). This creates a window where the keyboard can lock up if the recovery races badly between instances or the driver gets stuck.

**Mitigations in the manager script:**
- **Sleep/wake restart:** Detects sleep via wall-clock jump (process is frozen during sleep, so a >30s gap between 3s polls means we slept). Force-restarts all kanata instances after wake to ensure a fresh DriverKit connection. This is the most critical mitigation — the DriverKit virtual keyboard output often breaks after extended sleep, leaving kanata holding the keyboard grab but unable to output keystrokes.
- **Disconnect debouncing (15s grace period):** BLE keyboards that briefly disappear don't trigger kanata restarts. This dramatically reduces the number of driver reconnection storms.
- **Persistent logging:** Logs go to `/Library/Logs/kanata/` (survives reboots, unlike `/tmp`). Uses append mode (`>>`) with rotation at ~500KB.
- **`--nodelay` flag:** Eliminates the 2-second startup delay, reducing the window where keyboard is ungrabbed during restarts.
- **Force-kill on stop:** After SIGTERM, waits 1 second then sends SIGKILL to prevent orphaned kanata processes holding exclusive keyboard grabs.

**Kanata's built-in recovery:** When the DriverKit connection drops, kanata releases all seized input devices (physical keyboard works normally), polls every 500ms for recovery, then re-grabs after a 1-second settling delay. This is in `src/kanata/macos.rs`. However, this doesn't reliably work after system sleep — the DriverKit daemon may report "connected" via callbacks while the actual keyboard output path is broken.

**If keyboard locks up:** The built-in escape hatch is `LCtrl+Space+Escape` (physical keys, before remapping). This force-exits kanata and the manager will restart it.

## Setup on MacOS

Add `/opt/homebrew/bin/kanata` in
`System Settings > Privacy & Security > Input Monitoring`

Make sure that `Karabiner Non-Privileged Agents` is not starting with login items

Make sure that the
`System Settings > Keyboard > Keyboard Shortcuts > Modifier Keys`
settings are unchanged for the Karabiner Virtual Keyboard

[Launchctl Reference](https://github.com/jtroo/kanata/discussions/1086)

### Useful commands

Get daemon status and configs

```sh
sudo launchctl list | grep kanata
sudo launchctl print system/io.github.jtroo.kanata.manager
```

Get logs

```sh
cat /tmp/io.github.jtroo.kanata.manager.log              # manager log (launchd stdout)
cat /Library/Logs/kanata/io.github.jtroo.kanata.macbook-ansi.log  # per-keyboard kanata logs
cat /Library/Logs/kanata/io.github.jtroo.kanata.razer.log
cat /Library/Logs/kanata/io.github.jtroo.kanata.go60.log
```

## Linux

Restart

```sh
systemctl --user restart kanata.service
```

Get logs

```sh
journalctl --user -u kanata.service
```

View keyboard events

```sh
evtest
```

## Razer Blackwidow

TODO: Enable macro keys

https://github.com/equk/blackwidow_macro
