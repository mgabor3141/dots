#!/usr/bin/env bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Show asterisks when typing sudo password

if [ "$(id -u)" -ne 0 ]; then
    sudo "$0" "$@"
    exit $?
fi

echo 'Defaults pwfeedback' > /etc/sudoers.d/pwfeedback
chmod 0440 /etc/sudoers.d/pwfeedback

# Validate syntax
visudo -cf /etc/sudoers.d/pwfeedback

echo "✅ sudo pwfeedback enabled"
