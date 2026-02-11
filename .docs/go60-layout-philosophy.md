# Go60 Layout Philosophy

Custom layout for the MoErgo Go60 split ergonomic keyboard, forked from the TailorKey default and rebuilt around a few core principles.

## One-handed operation

The primary design goal is to keep the right hand on the mouse/trackpad as much as possible. All non-typing actions — navigation, deletion, modifiers, window management — are accessible with the left hand alone. The Nav layer puts arrow keys, page up/down, home/end, and a numpad all within left-hand reach, while backspace and delete are on the thumb cluster.

## Thumbs do the heavy lifting

Modifiers and layer switching live on the thumb keys, keeping the fingers free for typing. The left thumb cluster handles Ctrl (hold) / Enter (tap), WM modifier (hold) / previous workspace (tap), and Nav layer activation. The right thumb cluster handles Space, Backspace, and the Symbol layer (sticky).

## Layers have clear roles

- **Base**: Typing only. No dual-role keys on the alpha block (except sticky shift on the home row).
- **Nav**: Left-hand navigation (arrows, home/end, page up/down) + right-hand numpad. Also provides one-handed backspace and ctrl+backspace.
- **Symbol**: Programming symbols on the left, Hungarian characters on the right (via RightAlt, interpreted by the OS-level keylayout).
- **WM**: Window manager shortcuts, activated by holding the WM thumb key (which also holds the WM modifier).
- **Gaming**: Separate layout optimized for games, with visual RGB feedback on activation.

## Cross-keyboard consistency (with boundaries)

This layout runs alongside kanata (software key remapper) on macOS and Linux. The Go60's ZMK firmware handles the physical layout and layers, while kanata handles OS-level concerns: Ctrl/Cmd swap for cross-platform consistency, Tab un-swap for app/tab switchers, and key override normalization.

Traditional keyboards (MacBook built-in, Razer BlackWidow) are kept deliberately close to stock. The Go60 is a different enough physical experience that the brain maintains separate muscle memory — trying to partially replicate the Go60 layout on traditional keyboards causes more confusion than it solves.

## Dictation and media

Mute (F13) is on a two-key combo that works across all layers. Dictation is activated via Nav + WM thumb key (left hand only), with a matching chord on traditional keyboards via kanata.
