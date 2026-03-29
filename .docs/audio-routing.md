# Audio Routing

PipeWire/WirePlumber setup with Focusrite Scarlett 8i6 USB Gen 3, supporting separate comms audio and MacBook integration via the Scarlett's hardware mixer.

## Architecture

```
┌─────────────┐       USB (direct, always on)       ┌──────────────┐
│  Linux PC   │────────────────────────────────────→ │  Scarlett    │
│             │       PCM 1–6 in/out                 │  8i6 USB     │
└──────┬──────┘                                      │              │
       │ DP/HDMI                                     │  HP1 ──→ 🎧  │
       │                                             │              │
┌──────┴──────┐       3.5mm jack                     │  Line In     │
│  M32U       │─────────────────────────────────────→│  3/4         │
│  Monitor    │       (audio from active input)      │              │
│  (KVM)      │                                      │  HP2 ──→ ┐   │
└──────┬──────┘                                      └──────────┼───┘
       │ USB-C (video + KVM hub)                                │
       │                                              RCA cable │
┌──────┴──────┐       KVM USB hub                    ┌──────────┴───┐
│  MacBook    │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌→ │  Behringer   │
│             │       (only when KVM = MacBook)       │  UCA         │
└─────────────┘                                      └──────────────┘
```

**Key design:** The Scarlett is direct-connected to the Linux PC (not on the KVM). This eliminates USB bounce issues and xHCI deadlock risk. MacBook audio reaches the Scarlett via the monitor's headphone jack → analogue inputs.

## PipeWire virtual sinks and sources

Defined declaratively in `~/.config/pipewire/pipewire.conf.d/10-virtual-sinks.conf` using `libpipewire-module-loopback`. Each module creates two internally-linked nodes. WirePlumber handles linking to/from hardware via `target.object`.

| Node | Type | Purpose |
|------|------|---------|
| `system-audio` | Sink | All apps (default sink) |
| `comms` | Sink | Discord/comms (via stream-restore) |
| `mic` | Source | All apps (default source); mute hotkey mutes this |

The `mic` virtual source wraps the Scarlett hardware mic. Muting it silences the mic for Discord and other apps, while handy (dictation) bypasses it by connecting directly to the Scarlett via a WirePlumber stream rule.

No scripts, no systemd services; PipeWire creates everything at startup.

## Scarlett hardware mixer

Configured via `alsa-scarlett-gui` or `amixer -c USB`. The internal mixer combines Linux PCM + MacBook analogue input:

```
Mixer Inputs:
  01 = Analogue 3   (MacBook L, via monitor headphone jack)
  02 = Analogue 4   (MacBook R, via monitor headphone jack)
  03 = PCM 1        (Linux L)
  04 = PCM 2        (Linux R)
  08 = Analogue 1   (mic)

Mix A = Input 01 + Input 03  →  Analogue Output 01 (HP1 L) + S/PDIF Out 1
Mix B = Input 02 + Input 04  →  Analogue Output 02 (HP1 R) + S/PDIF Out 2
Mix H                        →  Analogue Output 03/04 (HP2, return to MacBook)
```

Full ALSA mixer state saved in `.docs/scarlett-mixer.state` (load via `alsa-scarlett-gui` import or `alsactl restore -f`). Runtime state persisted with `sudo alsactl store USB`.

## WirePlumber config

`~/.config/wireplumber/wireplumber.conf.d/51-audio-routing.conf`:
- Sets `system-audio` as the default configured sink
- Sets `mic` (virtual source) as the default configured source
- Routes handy directly to the Scarlett mic (bypasses virtual mic, unaffected by mute)
- Disables unused devices: Behringer UCA, NVIDIA HDMI/DP
- Deprioritizes Sunshine sinks (`priority.session = 0`)
- Prevents Scarlett mic from auto-connecting

Discord routing to `comms` is persisted via stream-restore in `~/.local/state/wireplumber/stream-properties`.

## Sunshine streaming

Sunshine creates `sink-sunshine-stereo` and sets it as default. Apps follow the default there. `~/.local/bin/sunshine-audio-fix` restores `system-audio` as default when the session ends.

## MacBook integration

When the KVM switches to the MacBook:
- MacBook audio → USB-C → monitor → 3.5mm headphone jack → Scarlett Line In 3/4
- Scarlett hardware mixer combines it with Linux PCM in Mix A/B → HP1
- Behringer UCA (on KVM hub) provides mic return: Scarlett HP2 → RCA → Behringer → MacBook

When KVM is on Linux: MacBook audio doesn't flow (monitor jack follows active input). Linux audio works normally.

## Volume control

Per-sink volume available in pwvucontrol or via CLI:

```sh
wpctl set-volume system-audio 0.8   # games/music
wpctl set-volume comms 1.0          # comms
```

## Troubleshooting

```sh
# Check routing
wpctl status

# Check links
pw-link -l

# Reset default sink
pactl set-default-sink system-audio

# If Discord isn't on comms, play audio and move it manually:
pactl list sink-inputs short | grep -i chromium
pactl move-sink-input <index> comms
# Persists via stream-restore
```
