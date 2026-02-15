#!/usr/bin/env bash
# Niri event-stream daemon — watches for Zed editor windows and assigns
# them to numbered workspaces based on project→workspace mappings in
# editor-workspaces.json.
#
# Started via spawn-sh-at-startup in niri config.kdl.

WM_SCRIPTS="$HOME/.config/wm-scripts"

# Wait for niri IPC to be ready
for _ in $(seq 1 30); do
    niri msg version &>/dev/null && break
    sleep 0.5
done

# Debounce: avoid re-running assign for the same window within this many seconds
declare -A LAST_ASSIGN
DEBOUNCE_SECS=2

while IFS= read -r line; do
    # Fast path: extract event type without full jq parse
    event_type="${line%%\":{*}"
    event_type="${event_type#*\"}"

    case "$event_type" in
        WindowOpenedOrChanged)
            app_id=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.app_id')

            # Dynamic editor workspace assignment
            if [ "$app_id" = "dev.zed.Zed" ]; then
                wid=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.id')
                now=$(date +%s)
                last=${LAST_ASSIGN[$wid]:-0}
                if (( now - last >= DEBOUNCE_SECS )); then
                    LAST_ASSIGN[$wid]=$now
                    "$WM_SCRIPTS/assign-editor-workspace.sh" &
                fi
            fi
            ;;
    esac
done < <(niri msg -j event-stream)
