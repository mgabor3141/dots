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
cat /tmp/io.github.jtroo.kanata.manager.log
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
