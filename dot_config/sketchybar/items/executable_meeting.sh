#!/bin/bash

sketchybar --add item meeting right \
  --set meeting \
    update_freq=0 \
    drawing=off \
    label.font="Hack Nerd Font:Bold:13.0" \
    label.width=42 \
    label.align=right \
    label.background.drawing=on \
    label.background.color=0x00000000 \
    label.background.corner_radius=5 \
    label.background.height=20 \
    popup.align=center \
    popup.background.color="$BAR_COLOR" \
    popup.background.corner_radius=7 \
    popup.background.drawing=on \
    popup.blur_radius=20 \
    popup.y_offset=4 \
    popup.drawing=off \
    script="$PLUGIN_DIR/meeting.sh" \
  --subscribe meeting clock_tick system_woke mouse.entered mouse.exited mouse.clicked \
  \
  --add item meeting.title popup.meeting \
  --set meeting.title \
    icon.drawing=off \
    label.font="Hack Nerd Font:Bold:13.0" \
    label.color="$ACCENT_COLOR" \
    background.drawing=off
