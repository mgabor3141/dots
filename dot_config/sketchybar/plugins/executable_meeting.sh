#!/usr/bin/env bash
#
# Sketchybar plugin: show time until next meeting.
# Uses icalBuddy to read from the macOS Calendar store.
# Hover: popup pill with meeting title. Click: open Google Calendar.

WITHIN_MINUTES=30
ALERT_AT_MINUTES=1
URGENT_MINUTES=5
ALERTED_FILE="$HOME/.local/share/sketchybar/.meeting_alerted"
HELPER_DIR="$(dirname "$0")/../helpers"

if [ "$SENDER" = "mouse.clicked" ]; then
  "$HELPER_DIR/open_gcal.sh" &
  exit 0
fi

if [ "$SENDER" = "mouse.entered" ]; then
  sketchybar --set "$NAME" popup.drawing=on
  exit 0
fi

if [ "$SENDER" = "mouse.exited" ]; then
  sketchybar --set "$NAME" popup.drawing=off
  exit 0
fi

# Get next event: "2026-02-13 at 09:00 - 09:30\tMeeting Title"
line=$(icalBuddy -n -li 1 -nc -nrd -ea -npn \
  -iep "title,datetime" -po "datetime,title" \
  -df "%Y-%m-%d" -tf "%H:%M" -b "" -ps "|	|" eventsToday+1 2>/dev/null)

if [[ -z "$line" ]]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

# Parse: datetime part is before tab, title is after
datetime_part="${line%%	*}"
title="${line#*	}"

# Extract date and start time from "2026-02-13 at 09:00 - 09:30"
date_str="${datetime_part%% at *}"
time_str="${datetime_part#* at }"
start_time="${time_str%% - *}"

# Calculate minutes until event
event_epoch=$(date -j -f "%Y-%m-%d %H:%M" "$date_str $start_time" +%s 2>/dev/null)
if [[ -z "$event_epoch" ]]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

now_epoch=$(date +%s)
diff_minutes=$(( (event_epoch - now_epoch) / 60 ))

if (( diff_minutes > WITHIN_MINUTES )); then
  sketchybar --set "$NAME" drawing=off
else
  if (( diff_minutes <= 0 )); then
    label="NOW"
  elif (( diff_minutes == 1 )); then
    label="1m"
  else
    label="${diff_minutes}m"
  fi

  # Alert once per meeting, 1 minute before start
  if (( diff_minutes <= ALERT_AT_MINUTES )); then
    last_alerted=$(cat "$ALERTED_FILE" 2>/dev/null)
    if [[ "$last_alerted" != "$event_epoch" ]]; then
      echo "$event_epoch" > "$ALERTED_FILE"
      terminal-notifier \
        -title "Meeting starting" \
        -message "$title" \
        -sound Ping \
        -execute "$HELPER_DIR/open_gcal.sh" &>/dev/null &
    fi
  fi

  if (( diff_minutes <= URGENT_MINUTES )); then
    label_color="0xffff4444"
  else
    label_color="0xeeffffff"
  fi

  sketchybar --set "$NAME" label="$label" label.color="$label_color" drawing=on \
             --set meeting.title label="$title"
fi
