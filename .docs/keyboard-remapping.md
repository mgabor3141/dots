# Keyboard Remapping

Cross-platform keyboard remapping setup that provides consistent keybindings across macOS and Linux through a multi-layered architecture.

## Core Concept: `secondary` Modifier

The `secondary` modifier abstraction normalizes the "main shortcut" key across platforms:

- **Linux**: `secondary` = `Ctrl` (native)
- **macOS**: `secondary` = `Cmd` (what macOS users expect)

Kanata defines this at the hardware level for the Razer keyboard (mapping Left Ctrl to Cmd on macOS). Application keybind templates (Zed, Kitty, etc.) use the same concept to generate platform-appropriate shortcuts.

## Layer 1: Hardware Level -- Kanata

Kanata intercepts raw keyboard input on both platforms (`dot_config/kanata/`).

**Key remappings:**
- **CapsLock**: sticky shift (one-shot: tap activates shift for next key only, hold works as normal shift)
- **Left Shift**: tap = Esc, hold = Alt
- **Right Shift**: sticky shift (same as CapsLock)
- **Left Ctrl** (Razer only): Secondary (Cmd on macOS, Ctrl on Linux)
- **Fn/Extend layer** (dedicated key): ESDF arrows, Home/End, PgUp/PgDn, Hungarian accented characters, media keys
- **Window Manager key**: hold = `Ctrl` on macOS (Aerospace) / `Super` on Linux (Niri); tap = `F20` (previous workspace)
- **Chords**: `= + Backspace` = Delete, `Fn + Ctrl` = F13

**Device management:**
- macOS: a custom manager daemon (`kanata-manager.sh`) polls for connected devices and spawns the correct Kanata config per keyboard (MacBook internal vs Razer BlackWidow). Runs as a LaunchDaemon.
- Linux: a single hardened systemd service running the Razer config (with `linux-continue-if-no-devs-found` for hot-plug).

## Layer 2: OS-Level Translation

### Hammerspoon (macOS only)

Hammerspoon (`exact_dot_hammerspoon/`) operates after Kanata via eventtaps and handles macOS-specific behavior:

**Key remapping** (`remap.lua`):

| Input | Output | Purpose |
|---|---|---|
| Cmd+Arrow | Alt+Arrow | Word navigation (matching Linux Ctrl+Arrow post-Kanata) |
| Cmd+Backspace/Delete | Alt+Backspace/Delete | Word deletion |
| Alt+Left/Right | Alt+F18/F19 | Frees Alt+Arrow for app-level rebinding |
| Home/End | Cmd+Left/Right | macOS line start/end |

**Ctrl+Tab / Cmd+Tab swap** (`tabswap.lua`): Swaps these two shortcuts with full modifier hold support so the app switcher / tab switcher UIs stay open while the physical modifier is held.

**Global hotkeys** (`hotkeys.lua`): `Ctrl+Z` close window, `Ctrl+X` toggle float/tile, `Ctrl+.` emoji picker, sleep.

### XKB (Linux only)

Custom XKB layout (`dot_config/xkb/`) defines F13-F24 and Hungarian accented characters via RightAlt, mirroring the macOS custom `.keylayout` file.

## Layer 3: Application Keybinds

### Zed (generated)

Zed keybindings (`dot_config/zed/keymap.json.tmpl`) are generated via a chezmoi template pipeline:

1. Downloads Zed's **stock Linux keybindings** from GitHub (version-matched via `.chezmoiexternal.toml`)
2. On Linux: uses them as-is
3. On macOS: a jq transform rewrites every binding:
   - `ctrl` -> `secondary` (Cmd)
   - `alt+left/right` -> `alt+f18/f19` (matching Hammerspoon output)
   - `home/end` -> `cmd+left/right`
   - `secondary+tab` -> `ctrl+tab` (Cmd+Tab is the OS app-switcher)
   - Removes `app_menu::` actions (not available under tiling WM)
4. Appends `.custom-keymap.jsonc` overrides (uses `secondary` throughout, works on both platforms without transformation)

### Other Apps

All follow the same pattern with platform-aware chezmoi templates:

| App | Approach |
|---|---|
| Kitty | `kitty_mod` = `ctrl+shift` on Linux, `super+shift` on macOS |
| Cursor/VS Code | Template swaps `ctrl`/`cmd` per platform |
| WebStorm | Selects "VSCode" keymap on Linux, "VSCode OSX" on macOS |
| Zen Browser | Separate shortcut profiles per platform |
| Fish shell | `Ctrl+G` history toggle, `Alt+Shift+M` mouse tracking |

## Supporting Infrastructure

- **macOS symbolic hotkeys** (`com.apple.symbolichotkeys.plist`): Disables nearly all default macOS shortcuts to prevent conflicts with Kanata/Hammerspoon/Aerospace.
- **Aerospace** (macOS) / **Niri** (Linux): Tiling WMs with mirrored workspace keybindings (`Ctrl+{A,W,R,T,1-5}` on macOS, `Super+{...}` on Linux).
- **Vesktop patch** (Linux): IPC pipe for Discord mute/deafen hotkeys on Wayland where global hotkeys don't work.

## Signal Chain

```
Physical Key -> Kanata (HID) -> Hammerspoon/XKB (OS) -> App Keybinds
```

**macOS example** (Ctrl+C with Razer):
1. Kanata: Left Ctrl -> Cmd (via `@lse` secondary)
2. Hammerspoon: passes Cmd+C through
3. Zed: `secondary+c` (= `cmd+c`) = copy

**Linux example** (same physical action):
1. Kanata: Left Ctrl -> Ctrl (identity)
2. XKB: passes Ctrl+C through
3. Zed: `ctrl+c` = copy

The programmable keyboard (Razer BlackWidow) has its own Kanata config accounting for its different physical layout, but feeds into the same pipeline -- logical behavior stays identical regardless of keyboard or OS.
