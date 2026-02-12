#!/bin/bash

sketchybar --add event clock_tick

sketchybar --add item clock right \
  --set clock \
    update_freq=60 \
    script="$PLUGIN_DIR/clock.sh" \
  --subscribe clock clock_tick system_woke

sketchybar --add item calendar right \
  --set calendar \
    update_freq=60 \
    script="$PLUGIN_DIR/calendar.sh" \
  --subscribe calendar clock_tick system_woke

# Start clock daemon (kill previous instance if reloading)
pkill -f "clock_daemon" 2>/dev/null
"$CONFIG_DIR/helpers/clock_daemon.sh" &
disown
