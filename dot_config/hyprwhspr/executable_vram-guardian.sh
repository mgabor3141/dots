#!/usr/bin/env bash
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# VRAM Guardian for hyprwhspr
# Monitors GPU memory and stops/starts hyprwhspr to free VRAM under pressure.
# hyprwhspr uses ~560 MiB VRAM for its whisper model — worth reclaiming when gaming.

POLL_INTERVAL=10          # seconds between checks
STOP_THRESHOLD_PCT=75     # stop hyprwhspr when VRAM usage exceeds this %
START_THRESHOLD_PCT=50    # restart hyprwhspr when VRAM usage drops below this %
SERVICE="hyprwhspr.service"

get_vram_pct() {
    local stats
    stats=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null) || return 1
    local used total
    used=$(echo "$stats" | cut -d',' -f1 | tr -d ' ')
    total=$(echo "$stats" | cut -d',' -f2 | tr -d ' ')
    echo $(( used * 100 / total ))
}

echo "VRAM Guardian started (stop>${STOP_THRESHOLD_PCT}% / restart<${START_THRESHOLD_PCT}%)"

while true; do
    pct=$(get_vram_pct) || { sleep "$POLL_INTERVAL"; continue; }

    service_active=$(systemctl --user is-active "$SERVICE" 2>/dev/null || true)

    if (( pct > STOP_THRESHOLD_PCT )); then
        if [[ "$service_active" == "active" ]]; then
            echo "$(date '+%H:%M:%S') VRAM ${pct}% > ${STOP_THRESHOLD_PCT}% — stopping $SERVICE"
            systemctl --user stop "$SERVICE"
        fi
    elif (( pct < START_THRESHOLD_PCT )); then
        if [[ "$service_active" != "active" ]]; then
            echo "$(date '+%H:%M:%S') VRAM ${pct}% < ${START_THRESHOLD_PCT}% — restarting $SERVICE"
            # reset-failed clears error state; setting StartLimitBurst=0 via
            # runtime override disables the rate limiter so our managed
            # stop/start cycles never get blocked by systemd.
            systemctl --user reset-failed "$SERVICE" 2>/dev/null
            systemctl --user start "$SERVICE" 2>/dev/null || {
                echo "$(date '+%H:%M:%S') Start blocked by rate limit, resetting..."
                systemctl --user stop "$SERVICE" 2>/dev/null
                systemctl --user reset-failed "$SERVICE" 2>/dev/null
                sleep 2
                systemctl --user start "$SERVICE"
            }
        fi
    fi

    sleep "$POLL_INTERVAL"
done
