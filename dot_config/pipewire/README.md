# PipeWire

Custom PipeWire config lives in `pipewire.conf.d/`:

- `custom.conf` — Lowers `default.clock.min-quantum` to 256 for lower audio latency.
- `10-virtual-sinks.conf` — Creates three virtual nodes (System Audio, Comms, Mic)
  as loopbacks in front of the Scarlett interface. Muting the `mic` node silences
  the loopback output to all apps; `handle-mute-events.sh` bypasses that by
  re-linking to the raw Scarlett directly via `pw-link`.

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
