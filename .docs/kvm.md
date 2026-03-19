# KVM (Gigabyte M32U)

The Gigabyte M32U monitor has a built-in KVM switch using a Realtek USB hub (0bda:5411). It connects peripherals (mouse, keyboard, webcam, Scarlett 8i6) to whichever input is active.

## Known issues

### 1. USB hub bouncing during switches

**Problem:** When switching inputs, the KVM hub disconnects and reconnects multiple times over ~10–30 seconds before settling. This is normal behavior for this monitor's Realtek hub — firmware updates (latest: F11, circa 2022) haven't fixed it.

**Impact:** Any driver that tries to use a device during a bounce can get stuck. The worst case is `snd_usb_audio` (Scarlett) — stuck URBs deadlock the xHCI controller, killing ALL USB. Requires hard reboot.

**Workaround:** The `scarlett-kvm-reconnect.service` waits 10 seconds after the Scarlett appears before starting audio, then verifies it's still present. See [Audio after KVM switch](#audio-after-kvm-switch) below.

### 2. Audio lost after KVM switch

**Problem:** `alsa-restore` and `system-audio-sink.service` run at boot. If the KVM is on the other machine at boot, the Scarlett doesn't exist yet. When it later appears (KVM switch), the ALSA mixer may not be initialized and PipeWire's loopback connections are stale — everything *looks* connected but no sound comes out.

**Workaround:** Automatic via udev rule + systemd service. See [Audio after KVM switch](#audio-after-kvm-switch) below.

### 3. Suspend/resume failure

**Problem:** Suspend-to-RAM sometimes fails to resume, causing a cold reboot instead of wake. Likely related to NVIDIA GSP firmware, not the KVM directly. An existing `nvidia-resume-check.service` (`~/.local/bin/gpu-resume-check`) handles GPU recovery on successful resume.

**Status:** No fix. The GPU resume check helps when resume works but the GPU is unhealthy. When resume fails entirely (kernel can't wake), there's nothing to do — the machine reboots.

## Workarounds in place

### Audio after KVM switch

**Files:** `~/.config/scarlett-kvm/`
- `99-scarlett-kvm.rules` → `/etc/udev/rules.d/`
- `scarlett-kvm-reconnect.service` → `/etc/systemd/system/`
- `run_onchange_after_install-scarlett-kvm.sh.tmpl` installs both with sudo

**Flow:**
1. Scarlett appears on USB → udev matches vendor `1235`, product `8213`
2. Triggers `scarlett-kvm-reconnect.service`
3. Service waits **10 seconds** for the KVM hub to stop bouncing
4. Checks the Scarlett is still in `/sys/bus/usb/devices/*/product` — exits if gone
5. Restarts `system-audio-sink.service` → `~/.local/bin/system-audio-setup`, which:
   - Sets the Scarlett's card profile
   - Restores ALSA mixer state (`alsactl restore USB`)
   - Tears down and recreates virtual sinks + loopbacks

**Limitations:**
- Apps playing audio (Spotify, browsers) lose their PipeWire connection and need restart
- If the KVM bounces for longer than 10 seconds, the race condition could still occur
- Run `sudo alsactl store USB` after any ALSA mixer changes to persist them

### USB wakeup

`/etc/udev/rules.d/70-usb-wakeup-mouse.rules` enables wake-from-suspend for the Logitech G502 mouse so mouse movement can wake the system.

## Hardware details

| Component | Details |
|-----------|---------|
| Monitor | Gigabyte M32U (manufactured 2021-W27) |
| KVM hub | Realtek USB2.1 Hub (0bda:5411) + USB3.2 Hub (0bda:0411) |
| USB port | `1-3` (hub), devices on `1-3.1`–`1-3.6` |
| Audio | Focusrite Scarlett 8i6 USB Gen 3 (1235:8213) at `1-3.3` |
| Firmware | Cannot check version from Linux or OSD; requires Windows OSD Sidekick app. Latest available: F11 (2022). |

## Troubleshooting

**No audio after KVM switch:**
```sh
# Check if the service ran
journalctl -u scarlett-kvm-reconnect.service --since "5 min ago"
# Manual recovery (same thing the service does)
systemctl --user restart system-audio-sink.service
# Restart apps that were playing audio
```

**USB completely dead (keyboard/mouse gone):**

Hard reboot required. Check `journalctl -b -1 -k | grep xhci` for `host controller not responding, assume dead`. This means `snd_usb_audio` deadlocked the xHCI controller during a KVM bounce.

**Check if Scarlett is present:**
```sh
grep -r "Scarlett" /sys/bus/usb/devices/*/product 2>/dev/null
```
