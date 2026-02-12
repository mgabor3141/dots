# Hammerspoon

## Manual setup steps

Swap Cmd and Ctrl in
`System Preferences -> Keyboard -> Keyboard Shortcuts -> Modifiers`
on keyboards that need it

Restart Hammerspoon after giving accessibility permissions to it

## Global Mute Toggle

F13 (physical key on Razer, chord on other keyboards via kanata) toggles mic mute. Kanata remaps F13 → Hyper+M on macOS because macOS sends bare F13 as `NSSystemDefined` events (type 14) that `hs.hotkey` can't catch.

The Scarlett 8i6 USB (primary audio interface) doesn't expose mute or volume controls to CoreAudio — both `inputVolume()` and `inputMuted()` return nil. The mute mechanism works around this by switching the default input device to the MacBook Pro Microphone (and muting it), then switching back to unmute.

### FluidVoice Guard

Switching the default input device mid-stream crashes FluidVoice (dictation app). The toggle detects active dictation by checking for FluidVoice's overlay window (an `AXSystemDialog` subrole window that only exists during dictation) and refuses to mute while it's present. The main FluidVoice settings window (`AXStandardWindow`) does not trigger the guard.
