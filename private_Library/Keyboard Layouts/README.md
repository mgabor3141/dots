# Keylayouts

## Important: Logout Required

macOS caches `.keylayout` files at login. After `chezmoi apply` deploys changes, **you must log out and back in** for the new layout to take effect. There is no way to reload keylayout files without relogging. A `run_onchange_after_` script warns about this automatically when the file changes.

## Instructions

macOS Shortcuts settings:

Disable everything except screenshots. Note that input switching gets re-enabled whenever a second layout is added.

## Resources

Keylayout from: http://wordherd.com/keyboards/ modified to be a Unicode layout
Keylayout XML spec: https://developer.apple.com/library/archive/technotes/tn2056/
Ukelele editor, has very good info in built-in help PDF: https://software.sil.org/ukelele/
