#!/usr/bin/env bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# See:
# https://wiki.archlinux.org/title/Power_management/Suspend_and_hibernate
# https://www.man7.org/linux/man-pages/man5/logind.conf.5.html
# /etc/systemd/logind.conf

# Upgrade to sudo
if [ "$(id -u)" -ne 0 ]; then
    sudo "$0" "$@"
    exit $?
fi

# --- logind sleep/power button config ---
mkdir -p /etc/systemd/logind.conf.d
cat << EOF > /etc/systemd/logind.conf.d/50-sleep.conf
[Login]
SleepOperation=suspend
HandlePowerKey=ignore
HandlePowerKeyLongPress=poweroff
IdleAction=suspend
IdleActionSec=35min
EOF

# --- Beep on shutdown/reboot ---
# Audible confirmation that a graceful shutdown started. Useful when the
# display is dead (e.g. GPU crash) — you hear the beep and know it's safe
# to release the power button.
cat << 'EOF' > /etc/systemd/system/shutdown-beep.service
[Unit]
Description=Beep on shutdown/reboot (confirms graceful shutdown started)
DefaultDependencies=no
Before=shutdown.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'echo -e "\a" > /dev/console 2>/dev/null; sleep 0.15; echo -e "\a" > /dev/console 2>/dev/null'

[Install]
WantedBy=reboot.target
WantedBy=poweroff.target
EOF

systemctl daemon-reload
systemctl enable shutdown-beep.service

# Reload logind config without restarting (SIGHUP is the documented way,
# safe for active sessions — see man systemd-logind).
systemctl kill -s HUP systemd-logind

echo "✅ Sleep/power config and shutdown beep installed"
