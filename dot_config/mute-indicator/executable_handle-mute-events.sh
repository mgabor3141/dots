#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

SCARLETT_MIC="alsa_input.usb-Focusrite_Scarlett_8i6_USB_F8D9XVT150B68B-00.multichannel-input"

# Rewire handy's capture stream directly to the Scarlett mic, bypassing the
# mic loopback and easyeffects chain so dictation works even when muted.
# WirePlumber's policy engine can't resolve raw hardware as a stream target,
# so we manipulate the PipeWire graph directly with pw-link.
route_handy() {
    # Quick check: bail if handy isn't capturing
    local ports
    ports=$(pw-link -i 2>/dev/null | grep '^alsa_capture\.handy:input_F[LR]$') || return 0

    echo "$ports" | while IFS= read -r port; do
        local suffix="${port##*:}"
        local src_port
        case "$suffix" in
            input_FL) src_port="${SCARLETT_MIC}:capture_AUX0" ;;
            input_FR) src_port="${SCARLETT_MIC}:capture_AUX1" ;;
            *) continue ;;
        esac
        # Skip if already linked to the Scarlett
        pw-link -l "$src_port" 2>/dev/null | grep -qF "$port" && continue
        # Disconnect any existing links to this port, then link to Scarlett
        pw-link -l 2>/dev/null | awk -v port="$port" '
            $0 ~ "-> " port "$" { print prev }
            { prev = $0 }
        ' | while IFS= read -r existing; do
            existing="${existing#"${existing%%[![:space:]]*}"}"  # trim leading whitespace
            existing="${existing%% *}"  # trim trailing
            [ -n "$existing" ] && pw-link -d "$existing" "$port" 2>/dev/null || true
        done
        pw-link "$src_port" "$port" 2>/dev/null || true
    done
}

# Read pactl subscribe output line by line
while IFS= read -r line; do
    case "$line" in
        *"Event 'change' on source #"*)
            discord_id=$(niri msg --json windows 2>/dev/null | jq -r '.[] | select(.app_id == "vesktop") | .id' 2>/dev/null) || true

            if pactl get-source-mute mic 2>/dev/null | grep -q "Mute: yes"; then
                # Muted
                systemctl --user kill --signal SIGUSR1 mute-indicator.service || true
                niri msg action set-window-urgent --id "$discord_id" || true
                echo "VCD_SELF_MUTE" >> $XDG_RUNTIME_DIR/vesktop-ipc || true
            else
                # Unmuted
                systemctl --user kill --signal SIGUSR2 mute-indicator.service || true
                niri msg action unset-window-urgent --id "$discord_id" || true
                echo "VCD_SELF_UNMUTE" >> $XDG_RUNTIME_DIR/vesktop-ipc || true
            fi
            ;;
        *"on source-output #"*)
            # Rewire handy to raw Scarlett whenever its capture stream appears
            # or changes state (e.g. after WirePlumber establishes links).
            # Idempotent: bails early if handy isn't capturing or already wired.
            route_handy
            ;;
    esac
done
