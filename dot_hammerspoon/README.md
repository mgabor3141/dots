# Hammerspoon

## Manual setup steps

Swap Cmd and Ctrl in
`System Preferences -> Keyboard -> Keyboard Shortcuts -> Modifiers`
on keyboards that need it

Restart Hammerspoon after giving accessibility permissions to it

## Global Mute Toggle

F13 (physical key on Razer, chord on other keyboards via kanata) toggles mic mute. Kanata remaps F13 → Hyper+M on macOS because macOS sends bare F13 as `NSSystemDefined` events (type 14) that `hs.hotkey` can't catch.

The Scarlett 8i6 USB (primary audio interface) doesn't expose mute or volume controls to CoreAudio — both `inputVolume()` and `inputMuted()` return nil. The mute mechanism works around this by switching the default input device to the MacBook Pro Microphone (and muting it), then switching back to unmute.

### Scarlett Disconnected / Reconnected

When the Scarlett is disconnected, the toggle still works — it mutes/unmutes the built-in mic directly. On unmute with no Scarlett, it just unmutes the built-in mic instead of trying to switch to a missing device.

An `hs.audiodevice.watcher` monitors for device additions (`dev#` events). When the Scarlett reconnects:
- **Not muted**: automatically restores the Scarlett as the default input.
- **Muted**: stays on the muted built-in mic; the next unmute will switch to the Scarlett.

On startup, the mute state is detected from the actual system state (built-in mic as default + muted), so Hammerspoon restarts don't lose track of mute status.

### FluidVoice Guard

Switching the default input device mid-stream crashes FluidVoice (dictation app). The toggle detects active dictation by checking for FluidVoice's overlay window (an `AXSystemDialog` subrole window that only exists during dictation) and refuses to mute while it's present. The main FluidVoice settings window (`AXStandardWindow`) does not trigger the guard.

## Sleep

Hyper+S triggers `systemSleep()` with a 0.5s delay (so the key-up event doesn't immediately wake the machine). The signal arrives via kanata:

- **Razer**: Physical Break key → kanata `@sleep` alias → Hyper+S
- **Go60**: ZMK firmware sends `C_SLEEP` (works on Linux natively) + `F21` (macOS ignores `C_SLEEP` entirely) → kanata defoverride maps F21 → Hyper+S

macOS has no native sleep keycode support — `C_SLEEP` (HID System Sleep) is never surfaced to userspace, not even to Karabiner's event viewer.
