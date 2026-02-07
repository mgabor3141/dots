# Audio Routing

PipeWire/WirePlumber setup for separate Discord audio and Sunshine streaming.

## Architecture

**Normal (no streaming):**
```
Apps (Spotify, games, etc.)
  → system-audio (virtual sink, default)
    → loopback → Scarlett 8i6 (local playback)

Discord / Vesktop
  → discord-audio (virtual sink, via stream-restore)
    → loopback → Scarlett 8i6 (local playback)
```

**During Sunshine streaming:**
```
Apps (Spotify, games, etc.)
  → sink-sunshine-stereo (Sunshine's sink, becomes default)
    → Sunshine captures .monitor (streaming to Moonlight)
    → loopback → Scarlett 8i6 (local playback, created by sunshine-audio-fix)

Discord / Vesktop
  → discord-audio (unchanged, excluded from stream)
    → loopback → Scarlett 8i6 (local playback)
```

## Components

### Virtual sinks & loopbacks

Created by `system-audio-sink.service` → `~/.local/bin/system-audio-setup`.

Runs at boot via systemd (oneshot). Uses `pactl load-module` to create:
- `system-audio` null-sink + loopback → Scarlett
- `discord-audio` null-sink + loopback → Scarlett

Also sets the Scarlett card profile and `system-audio` as the default sink.

### WirePlumber config

`~/.config/wireplumber/wireplumber.conf.d/51-audio-routing.conf`

- Sets `default.configured.audio.sink = "system-audio"` so streams go there by default
- Deprioritizes `sink-sunshine-*` sinks (`priority.session = 0`, `node.autoconnect = false`)
- Prevents Scarlett mic from auto-connecting

**Important:** WirePlumber 0.5's `node.rules` in `wireplumber.profiles` only applies to device nodes, not stream nodes. Stream routing relies on the default sink and WirePlumber's stream-restore (saved per-stream targets). The Discord routing is persisted via stream-restore's saved `"target":"discord-audio"` in `~/.local/state/wireplumber/stream-properties`.

### Sunshine audio

Sunshine hardcodes creating `sink-sunshine-{stereo,surround51,surround71}` and calling `pa_context_set_default_sink()` on every session — there is no config option to disable this.

Rather than fighting the default-sink change, we work with it:
- Sunshine sets `sink-sunshine-stereo` as default → app audio flows there
- Sunshine captures from `sink-sunshine-stereo.monitor` → streams to Moonlight
- `~/.local/bin/sunshine-audio-fix` (triggered by `global_prep_cmd` in `sunshine.conf`) creates a loopback from `sink-sunshine-stereo → Scarlett` for local playback
- Discord stays on `discord-audio` via stream-restore, so it's excluded from the stream
- On session end, the loopback is removed and `system-audio` is restored as default

### ALSA buffer config

`50-alsa-config.conf` sets `api.alsa.period-size` and `api.alsa.headroom` for ALSA output nodes.

## Volume control

System audio and Discord have independent volume via their virtual sinks:

```sh
# Adjust Discord volume (0.0-1.0 normal, >1.0 to boost)
wpctl set-volume discord-audio 1.5

# Adjust system audio volume
wpctl set-volume system-audio 0.8

# Check current volumes
wpctl status
```

## Troubleshooting

Check current routing:
```sh
wpctl status
```

If streams are on the wrong sink, set the default and they'll follow:
```sh
pactl set-default-sink system-audio
```

If Discord isn't routing to `discord-audio`, the stream-restore state may be missing. Play some audio in Discord and manually move it:
```sh
# Find Discord's sink-input index
pactl list sink-inputs short | grep -i chromium
# Move it
pactl move-sink-input <index> discord-audio
```
This gets saved by stream-restore and persists across restarts.

Clear all saved stream routing (nuclear option):
```sh
rm ~/.local/state/wireplumber/stream-properties
systemctl --user restart wireplumber
```
