# PipeWire

Custom PipeWire config lives in `pipewire.conf.d/`:

- `custom.conf` — Sets quantum=256 (5.3ms), min=64, max=1024 for low-latency
  audio. The Scarlett 8i6 defaults to quantum 2048 (~43ms) which causes
  noticeable A/V desync in video editors (Kdenlive/MLT). Quantum 256 survives
  full CPU saturation with RT scheduling active. Going below 128 causes
  crackling under heavy load.
- `10-virtual-sinks.conf` — Creates three virtual nodes (System Audio, Comms, Mic)
  as loopbacks in front of the Scarlett interface. Muting the `mic` node silences
  the loopback output to all apps; `handle-mute-events.sh` bypasses that by
  re-linking to the raw Scarlett directly via `pw-link`.

## Recovering from a Scarlett restart

If the Scarlett is power-cycled or its ALSA device disappears and reappears
(e.g. after `alsactl` reload, USB renumeration), the virtual sinks survive but
their playback sides stop being linked to the Scarlett. Apps still route to
`system-audio`, but `system-audio-playback:output_FL/FR` have no `|->` line
in `pw-link -lo` and you hear nothing.

This is because `node.autoconnect` only re-evaluates at node creation; the
loopback module instantiates its nodes once at pipewire startup and doesn't
recreate them when `target.object` reappears. `node.dont-reconnect = true` is
deliberate (keeps the virtual sinks visible to apps while the card is gone) and
`node.dont-fallback = true` prevents audio from silently leaking to built-in
audio.

Fix:

```fish
systemctl --user restart pipewire
```

This is rare enough that automating it (udev-triggered restart) isn't worth
the complexity. Promote to a udev rule if it starts happening regularly.

## Realtime scheduling gotcha

PipeWire's `module-rt` wants `SCHED_FIFO:88` and `nice -11` on its data loop
threads. Without those, any sustained CPU load (e.g. Discord software-encoding a
screen share) starves the audio pipeline and causes stutters, visible in the
journal as:

```
spa.audioconvert: out of buffers on port 0 2
```

The non-obvious part: **user services inherit `LimitNICE` and `LimitMEMLOCK`
from the systemd user manager (`user@.service`), which defaults to `LimitNICE=0`
and `LimitMEMLOCK=8M`.** A child service can't raise these above the parent,
so adding `LimitNICE=-11` to a `pipewire.service.d/` drop-in does nothing.

When `module-rt` fails to set nice, it falls back to RTKit, which caps RT
priority at 20 (`SCHED_RR:20` instead of `SCHED_FIFO:88`). That's not strong
enough to preempt a busy software encoder.

**Fix:** `.chezmoiscripts/linux/run_onchange_after_audio-rt.sh.tmpl` deploys
`/etc/systemd/system/user@.service.d/audio-rt.conf` with `LimitNICE=-11` and
`LimitMEMLOCK=infinity`. After apply, a full logout/login (or reboot) is
required because the running user manager keeps its startup limits.

Verify with:

```fish
chrt -p (pgrep -x pipewire | head -1)
# want: SCHED_FIFO on data-loop.0 at priority 88
```
