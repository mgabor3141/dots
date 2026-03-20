# KVM (Gigabyte M32U)

The Gigabyte M32U monitor has a built-in KVM switch using a Realtek USB hub (0bda:5411). It connects peripherals (mouse, keyboard, webcam) to whichever input is active.

**Note:** The Scarlett 8i6 is no longer on the KVM — it's direct-connected to the Linux PC. See [audio-routing.md](audio-routing.md) for details.

## Known issues

### 1. USB hub bouncing during switches

**Problem:** When switching inputs, the KVM hub disconnects and reconnects multiple times over ~10–30 seconds before settling. This is normal behavior for this monitor's Realtek hub — firmware updates (latest: F11, circa 2022) haven't fixed it.

**Impact:** Peripherals (mouse, keyboard, webcam) briefly disconnect during a switch. Not critical since the Scarlett is no longer on the KVM.

### 2. Suspend/resume failure

**Problem:** Suspend-to-RAM sometimes fails to resume, causing a cold reboot instead of wake. Likely related to NVIDIA GSP firmware, not the KVM directly. An existing `nvidia-resume-check.service` (`~/.local/bin/gpu-resume-check`) handles GPU recovery on successful resume.

**Status:** No fix. The GPU resume check helps when resume works but the GPU is unhealthy. When resume fails entirely (kernel can't wake), there's nothing to do — the machine reboots.

## Workarounds in place

### USB wakeup

`/etc/udev/rules.d/70-usb-wakeup-mouse.rules` enables wake-from-suspend for the Logitech G502 mouse so mouse movement can wake the system.

## Hardware details

| Component | Details |
|-----------|---------|
| Monitor | Gigabyte M32U (manufactured 2021-W27) |
| KVM hub | Realtek USB2.1 Hub (0bda:5411) + USB3.2 Hub (0bda:0411) |
| USB port | `1-3` (hub), devices on `1-3.1`–`1-3.6` |
| Firmware | Cannot check version from Linux or OSD; requires Windows OSD Sidekick app. Latest available: F11 (2022). |

## Troubleshooting

**USB completely dead (keyboard/mouse gone):**

Hard reboot required. Check `journalctl -b -1 -k | grep xhci` for `host controller not responding, assume dead`. This means `snd_usb_audio` deadlocked the xHCI controller during a KVM bounce. (Much less likely now that the Scarlett is off the KVM.)

```sh
# Check what's on the KVM hub
lsusb -t | grep -A5 "1-3"
```
