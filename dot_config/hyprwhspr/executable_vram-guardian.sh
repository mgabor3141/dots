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
stopped_by_us=false

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

    if [[ "$stopped_by_us" == false ]]; then
        if (( pct > STOP_THRESHOLD_PCT )); then
            if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
                echo "$(date '+%H:%M:%S') VRAM ${pct}% > ${STOP_THRESHOLD_PCT}% — stopping $SERVICE"
                systemctl --user stop "$SERVICE"
                stopped_by_us=true
            fi
        fi
    else
        if (( pct < START_THRESHOLD_PCT )); then
            echo "$(date '+%H:%M:%S') VRAM ${pct}% < ${START_THRESHOLD_PCT}% — restarting $SERVICE"
            systemctl --user reset-failed "$SERVICE" 2>/dev/null
            systemctl --user start "$SERVICE"
            stopped_by_us=false
        fi
    fi

    sleep "$POLL_INTERVAL"
done
