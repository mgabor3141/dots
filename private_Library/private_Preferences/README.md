# macOS Preferences (plists)

Manages `~/Library/Preferences/*.plist` files using chezmoi `modify_` scripts. Each script selectively sets specific keys while leaving everything else untouched — no full-file replacement.

## How it works

macOS stores preferences as binary plists. The `modify_` scripts receive the current binary plist on stdin, convert to XML, apply changes with PlistBuddy/plutil, convert back to binary, and write to stdout.

`.plist_common.sh` (dot-prefixed so chezmoi ignores it) provides the shared boilerplate: temp file setup, empty-plist initialization, XML conversion, and upsert helper functions. Each `modify_` script sources it, declares its settings, and calls `plist_finalize`.

`chezmoi diff` shows readable XML diffs instead of "Binary files differ" thanks to the `textconv` config in `.chezmoi.toml.tmpl`.

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
