#!/usr/bin/env bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Enable suspend wake for Logitech G502 HERO mouse (046d:c08b)
# so mouse movement/click can wake the system.

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

mkdir -p /etc/udev/rules.d
cat > /etc/udev/rules.d/70-usb-wakeup-mouse.rules <<'EOF'
# Keep mouse wake enabled across reconnects/reboots.
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="046d", ATTR{idProduct}=="c08b", TEST=="power/wakeup", ATTR{power/wakeup}="enabled"
EOF

# Apply the rule without reboot.
udevadm control --reload-rules
udevadm trigger --subsystem-match=usb --action=add

# Ensure currently connected matching devices are enabled immediately.
for dev in /sys/bus/usb/devices/*; do
  [ -f "$dev/idVendor" ] || continue
  [ -f "$dev/idProduct" ] || continue
  [ -f "$dev/power/wakeup" ] || continue

  vid="$(tr -d '\n' < "$dev/idVendor")"
  pid="$(tr -d '\n' < "$dev/idProduct")"

  if [ "$vid" = "046d" ] && [ "$pid" = "c08b" ]; then
    echo enabled > "$dev/power/wakeup"
  fi
done
