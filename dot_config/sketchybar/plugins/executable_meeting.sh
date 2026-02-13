#!/usr/bin/env bash
#
# Sketchybar plugin: show time until next meeting.
# Uses icalBuddy to read from the macOS Calendar store.
# Hover: popup pill with meeting title. Click: open Google Calendar.

WITHIN_MINUTES=30
ALERT_AT_MINUTES=1
URGENT_MINUTES=5
STATE_DIR="$HOME/.local/share/sketchybar"
ALERTED_FILE="$STATE_DIR/.meeting_alerted"
HELPER_DIR="$(dirname "$0")/../helpers"

mkdir -p "$STATE_DIR"

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

# Get next event, skipping [OOO] entries.
# icalBuddy returns: "2026-02-13 at 09:00 - 09:30\tMeeting Title" (one per line)
output=$(icalBuddy -n -nc -nrd -ea -npn \
  -iep "title,datetime" -po "datetime,title" \
  -df "%Y-%m-%d" -tf "%H:%M" -b "" -ps "|	|" eventsToday+1 2>/dev/null)

now_epoch=$(date +%s)
line=""
title=""
event_epoch=""
diff_minutes=""

while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue

  candidate_title="${candidate#*	}"

  # Skip [OOO] events
  [[ "$candidate_title" == "[OOO]"* ]] && continue

  candidate_dt="${candidate%%	*}"
  candidate_date="${candidate_dt%% at *}"
  candidate_timerange="${candidate_dt#* at }"
  candidate_start="${candidate_timerange%% - *}"

  candidate_epoch=$(date -j -f "%Y-%m-%d %H:%M" "$candidate_date $candidate_start" +%s 2>/dev/null)
  [[ -z "$candidate_epoch" ]] && continue

  candidate_diff=$(( (candidate_epoch - now_epoch) / 60 ))

  # Take the first non-OOO upcoming (or just-started) event
  if (( candidate_diff >= -5 )); then
    line="$candidate"
    title="$candidate_title"
    event_epoch="$candidate_epoch"
    diff_minutes="$candidate_diff"
    break
  fi
done <<< "$output"

if [[ -z "$line" ]]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

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
    alert_key="$event_epoch"
    last_alerted=$(cat "$ALERTED_FILE" 2>/dev/null)
    if [[ "$last_alerted" != "$alert_key" ]]; then
      echo "$alert_key" > "$ALERTED_FILE"
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
