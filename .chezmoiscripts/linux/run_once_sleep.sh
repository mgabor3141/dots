#!/bin/bash
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

mkdir -p /etc/systemd/logind.conf.d
cat << EOF > /etc/systemd/logind.conf.d/50-sleep.conf
[Login]
SleepOperation=suspend
HandlePowerKey=ignore
HandlePowerKeyLongPress=poweroff
IdleAction=suspend
IdleActionSec=35min
EOF
