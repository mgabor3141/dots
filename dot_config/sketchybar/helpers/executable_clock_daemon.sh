#!/usr/bin/env bash
#
# Clock daemon: sleeps until the next minute boundary, then triggers a
# sketchybar event. This replaces update_freq=1 polling (60 forks/min)
# with exactly 2 operations per minute while landing on :00 seconds.

while true; do
  sleep $((60 - $(date +%-S)))
  sketchybar --trigger clock_tick
done
