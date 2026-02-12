# macOS Preferences (plists)

Manages `~/Library/Preferences/*.plist` files using chezmoi `modify_` scripts. Each script selectively sets specific keys while leaving everything else untouched — no full-file replacement.

## How it works

macOS stores preferences as binary plists. The `modify_` scripts receive the current binary plist on stdin, convert to XML, apply changes with PlistBuddy/plutil, convert back to binary, and write to stdout.

`.plist_common.sh` (dot-prefixed so chezmoi ignores it) provides the shared boilerplate: temp file setup, empty-plist initialization, XML conversion, and upsert helper functions. Each `modify_` script sources it, declares its settings, and calls `plist_finalize`.

`chezmoi diff` shows readable XML diffs instead of "Binary files differ" thanks to the `textconv` config in `.chezmoi.toml.tmpl`.

## Finding the right key to set

When you want to manage a new preference, you need to figure out which plist key controls it. The general methodology:

### 1. Find the plist domain

Most apps store preferences at `~/Library/Preferences/<bundle-id>.plist`. If you know the app name but not the bundle ID:

```bash
# Search by app name
defaults domains | tr ',' '\n' | grep -i fluid
# → com.FluidApp.app
```

### 2. Inspect the plist as XML

macOS plists are binary. Convert to readable XML:

```bash
plutil -convert xml1 -o - ~/Library/Preferences/com.FluidApp.app.plist
```

Pipe through `less` or redirect to a file to browse. In Zed, you can open the XML output directly:

```bash
plutil -convert xml1 -o /tmp/fluid.xml ~/Library/Preferences/com.FluidApp.app.plist
zed /tmp/fluid.xml
```

Zed treats `.plist` files as XML natively. Within this repo, `.zed/settings.json` also maps `*.plist.tmpl` to XML and `modify_*.plist` to Shell Script so syntax highlighting works correctly for both.

### 3. Identify the key by diffing

If you can't tell which key controls a setting by reading the XML, toggle the setting in the app and diff:

```bash
# Snapshot before
plutil -convert xml1 -o /tmp/before.xml ~/Library/Preferences/com.FluidApp.app.plist

# Change the setting in the app's UI

# Snapshot after
plutil -convert xml1 -o /tmp/after.xml ~/Library/Preferences/com.FluidApp.app.plist

# Diff
diff /tmp/before.xml /tmp/after.xml
```

### 4. Handle `<data>` blobs

Some keys (especially hotkeys and complex structures) are stored as base64-encoded `<data>` values. Decode them to see the actual content:

```bash
# Copy the base64 string from the XML and decode it
echo 'eyJrZXlDb2RlIjoyLCJtb2RpZmllckZsYWdzUmF3VmFsdWUiOjE4MzUwMDh9' | base64 -d
# → {"keyCode":2,"modifierFlagsRawValue":1835008}
```

These are often JSON. The `keyCode` values correspond to macOS virtual key codes and `modifierFlagsRawValue` is a bitmask of modifier keys. Since these are device/preference-specific binary blobs, they're usually best left unmanaged (as the Fluid plist does with `HotkeyShortcutKey` and `CommandModeHotkeyShortcut`).

### 5. Quick key lookup with `defaults`

For simple values, `defaults read` is faster than converting the whole file:

```bash
# Read a specific key
defaults read com.FluidApp.app HotkeyShortcutKey

# Read all keys (less structured than XML but quick)
defaults read com.FluidApp.app
```

## Adding a new plist

1. Create `modify_private_<domain>.plist` (add `private_` prefix for `~/Library/` path encoding):

```bash
#!/bin/bash
# What this plist configures.
# shellcheck source=.plist_common.sh
source "$CHEZMOI_SOURCE_DIR/private_Library/private_Preferences/.plist_common.sh"

set_bool   SomeKey    true
set_string AnotherKey value
set_int    CountKey   42
set_real   FloatKey   0.5

plist_finalize
```

2. Run `chezmoi diff ~/Library/Preferences/<domain>.plist` to verify your changes.
3. Run `chezmoi apply ~/Library/Preferences/<domain>.plist` to apply.

## Available helpers (from .plist_common.sh)

| Function | Usage | Notes |
|---|---|---|
| `set_bool` | `set_bool Key true` | PlistBuddy upsert |
| `set_int` | `set_int Key 42` | PlistBuddy upsert |
| `set_real` | `set_real Key 0.5` | PlistBuddy upsert |
| `set_string` | `set_string Key value` | PlistBuddy upsert — simple values only |
| `pl_set_string` | `pl_set_string Key '"quoted"'` | plutil-based — handles literal quotes |
| `set_data_json` | `set_data_json Key '{"k":1}'` | JSON string → base64 `<data>` — readable in source |
| `pb` | `pb -c "Add :Key type val"` | Raw PlistBuddy (stdout redirected to stderr) |
| `$tmp` | `plutil -insert Key -json '[]' "$tmp"` | Temp file path for direct plutil calls |
| `plist_finalize` | `plist_finalize` | Call at end — converts to binary, outputs to stdout |

## Gotchas

- **PlistBuddy writes errors to stdout**, not stderr. The `pb()` wrapper redirects stdout to stderr so error messages don't corrupt binary output. Always use `pb` instead of calling PlistBuddy directly.
- **PlistBuddy can't handle literal quotes in strings.** Use `pl_set_string` or `plutil -insert ... -json` instead.
- **Upsert pattern:** `Set` (update existing) fails if key is missing, so helpers fall back to `Add` (create). For arrays/dicts that need rebuilding, delete first: `pb -c "Delete :Key" 2>/dev/null || true`.
- **Complex values** (arrays of dicts, nested structures): use `plutil -insert Key -json '...' "$tmp"` directly.
- **Only set what you care about.** Keys you don't touch are preserved as-is. This prevents fighting with macOS over system-managed keys (timestamps, cache state, etc.).
- **Scripts run from a temp directory**, not from the source dir. That's why we use `$CHEZMOI_SOURCE_DIR` to locate `.plist_common.sh`.
