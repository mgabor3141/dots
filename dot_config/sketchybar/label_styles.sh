#!/bin/bash

LABEL_TEXT_FONT="Hack Nerd Font:Regular:13.0"
LABEL_ICON_FONT="sketchybar-app-font:Regular:13.0"

LABEL_TEXT_PADDING_LEFT=4
LABEL_TEXT_PADDING_RIGHT=8
LABEL_TEXT_Y_OFFSET=0
LABEL_ICON_PADDING_LEFT=0
LABEL_ICON_Y_OFFSET=0

ICON_PADDING_RIGHT_TEXT=4
ICON_PADDING_RIGHT_ICON=0

apply_label_style() {
  local item="$1"
  local label="$2"
  local mode="$3"

  if [ "$mode" = "text" ]; then
    sketchybar --set "$item" \
      drawing=on \
      label="$label" \
      label.font="$LABEL_TEXT_FONT" \
      label.padding_left=$LABEL_TEXT_PADDING_LEFT \
      label.padding_right=$LABEL_TEXT_PADDING_RIGHT \
      label.y_offset=$LABEL_TEXT_Y_OFFSET \
      icon.padding_right=$ICON_PADDING_RIGHT_TEXT
  else
    sketchybar --set "$item" \
      drawing=on \
      label="$label" \
      label.font="$LABEL_ICON_FONT" \
      label.padding_left=$LABEL_ICON_PADDING_LEFT \
      label.y_offset=$LABEL_ICON_Y_OFFSET \
      icon.padding_right=$ICON_PADDING_RIGHT_ICON
  fi
}
