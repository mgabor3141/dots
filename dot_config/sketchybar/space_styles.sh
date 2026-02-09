#!/bin/bash

# ============================================
# Workspace Item Spacing Configuration
# ============================================
# Single source of truth for all sketchybar
# workspace item spacing. Sourced by both
# spaces.sh (creation) and space_windows.sh
# (dynamic updates).
#
# Spacing model for each workspace item:
#
#   |<-SPACE_PAD_L->|ICON|<-ICON_PAD_R->|LABEL|<-LABEL_PAD_R->|<-SPACE_PAD_R->|
#
# All padding varies by mode (text vs icon) for visual balance.
#
# The ICON is the workspace number/letter (e.g. "1", "W").
# The LABEL is either app icons or a text project name.
# Icon vs text labels use different fonts and need
# different padding to look visually balanced.
# ============================================

# --- Item-level padding ---
# Outer padding around the entire workspace item
SPACE_PADDING_LEFT_TEXT=2
SPACE_PADDING_RIGHT_TEXT=0
SPACE_PADDING_LEFT_ICON=2
SPACE_PADDING_RIGHT_ICON=4

# --- Icon (workspace number/letter) ---
SPACE_ICON_FONT_SIZE=17
SPACE_ICON_PADDING_LEFT=7
SPACE_ICON_PADDING_RIGHT_TEXT=4    # gap between icon and text label
SPACE_ICON_PADDING_RIGHT_ICON=0    # gap between icon and icon label

# --- Label: Text mode (project names like "chezmoi") ---
LABEL_TEXT_FONT="Hack Nerd Font:Regular:13.0"
LABEL_TEXT_PADDING_LEFT=4
LABEL_TEXT_PADDING_RIGHT=8
LABEL_TEXT_Y_OFFSET=0

# --- Label: Icon mode (app icons like ) ---
LABEL_ICON_FONT="sketchybar-app-font:Regular:13.0"
LABEL_ICON_PADDING_LEFT=0
LABEL_ICON_PADDING_RIGHT=12
LABEL_ICON_Y_OFFSET=0

# --- Background (highlight pill on focused workspace) ---
SPACE_BG_CORNER_RADIUS=4
SPACE_BG_HEIGHT=19

# --- Separator (chevron after all workspaces) ---
SEPARATOR_ICON_Y_OFFSET=2
SEPARATOR_ICON_PADDING_LEFT=6

# ============================================
# apply_label_style ITEM LABEL MODE
#   MODE: "text" or "icon"
#
# Sets font, padding, and y_offset on a
# workspace item's label. Called on every
# workspace update to ensure consistency.
# ============================================
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
      icon.padding_right=$SPACE_ICON_PADDING_RIGHT_TEXT \
      padding_left=$SPACE_PADDING_LEFT_TEXT \
      padding_right=$SPACE_PADDING_RIGHT_TEXT
  else
    sketchybar --set "$item" \
      drawing=on \
      label="$label" \
      label.font="$LABEL_ICON_FONT" \
      label.padding_left=$LABEL_ICON_PADDING_LEFT \
      label.padding_right=$LABEL_ICON_PADDING_RIGHT \
      label.y_offset=$LABEL_ICON_Y_OFFSET \
      icon.padding_right=$SPACE_ICON_PADDING_RIGHT_ICON \
      padding_left=$SPACE_PADDING_LEFT_ICON \
      padding_right=$SPACE_PADDING_RIGHT_ICON
  fi
}
