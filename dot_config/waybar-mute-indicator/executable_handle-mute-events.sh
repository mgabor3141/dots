#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Read pactl subscribe output line by line
while IFS= read -r line; do
    case "$line" in
        *"Event 'change' on source #"*)
            discord_id=$(niri msg --json windows | jq -r '.[] | select(.app_id == "vesktop") | .id')

            if pactl get-source-mute @DEFAULT_SOURCE@ | grep -q "Mute: yes"; then
                # Muted
                systemctl --user kill --signal SIGUSR1 waybar-mute-indicator.service || true
                niri msg action set-window-urgent --id "$discord_id" || true
                echo "VCD_SELF_MUTE" >> $XDG_RUNTIME_DIR/vesktop-ipc || true
            else
                # Unmuted
                systemctl --user kill --signal SIGUSR2 waybar-mute-indicator.service || true
                niri msg action unset-window-urgent --id "$discord_id" || true
                echo "VCD_SELF_UNMUTE" >> $XDG_RUNTIME_DIR/vesktop-ipc || true
            fi
            ;;
    esac
done
