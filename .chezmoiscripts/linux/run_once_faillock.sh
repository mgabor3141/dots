#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Configure pam_faillock to be less aggressive.
# Default deny=3 with unlock_time=600 causes frequent lockouts when
# sudo password is mistyped a few times (or an automated process fails auth).
# See: https://wiki.archlinux.org/title/Security#Lock_out_user_after_three_failed_login_attempts

# Upgrade to sudo
if [ "$(id -u)" -ne 0 ]; then
    sudo "$0" "$@"
    exit $?
fi

CONF=/etc/security/faillock.conf

# Set deny = 10 (default 3)
if grep -q '^deny\s*=' "$CONF"; then
    sed -i 's/^deny\s*=.*/deny = 10/' "$CONF"
elif grep -q '^#\s*deny\s*=' "$CONF"; then
    sed -i 's/^#\s*deny\s*=.*/deny = 10/' "$CONF"
else
    echo "deny = 10" >> "$CONF"
fi

# Set unlock_time = 60 (default 600)
if grep -q '^unlock_time\s*=' "$CONF"; then
    sed -i 's/^unlock_time\s*=.*/unlock_time = 60/' "$CONF"
elif grep -q '^#\s*unlock_time\s*=' "$CONF"; then
    sed -i 's/^#\s*unlock_time\s*=.*/unlock_time = 60/' "$CONF"
else
    echo "unlock_time = 60" >> "$CONF"
fi
