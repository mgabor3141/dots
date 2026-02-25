#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Enable sshd

# Upgrade to sudo
if [ "$(id -u)" -ne 0 ]; then
    sudo "$0" "$@"
    exit $?
fi

systemctl enable --now sshd.service
