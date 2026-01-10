#!/bin/bash

sketchybar --add item clock right \
  --set clock \
  update_freq=30 \
  script="$PLUGIN_DIR/clock.sh"

sketchybar --add item calendar right \
  --set calendar \
  update_freq=360 \
  script="$PLUGIN_DIR/calendar.sh"

# icon=􀧞
