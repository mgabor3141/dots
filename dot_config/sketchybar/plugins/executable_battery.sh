#!/bin/sh

PERCENTAGE="$(pmset -g batt | grep -Eo "\d+%" | cut -d% -f1)"
CHARGING="$(pmset -g batt | grep 'AC Power')"

[ -z "$PERCENTAGE" ] && exit 0

# Default color (white)
COLOR="0xffffffff"

# Low battery turns red when not charging
if [ "$PERCENTAGE" -lt 20 ] && [ -z "$CHARGING" ]; then
  COLOR="0xffff5555"
fi

# Hide battery item if above 75% and charging
if [ "$PERCENTAGE" -gt 75 ] && [ -n "$CHARGING" ]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
else
  sketchybar --set "$NAME" drawing=on
fi

case "${PERCENTAGE}" in
  9[0-9]|100) ICON=""
  ;;
  [6-8][0-9]) ICON=""
  ;;
  [3-5][0-9]) ICON=""
  ;;
  [1-2][0-9]) ICON=""
  ;;
  *) ICON=""
esac

if [ -n "$CHARGING" ]; then
  ICON=""
fi

# The item invoking this script (name $NAME) will get its icon and label
# updated with the current battery status
sketchybar --set "$NAME" \
  icon="$ICON" \
  label="${PERCENTAGE}%" \
  icon.color="$COLOR"
