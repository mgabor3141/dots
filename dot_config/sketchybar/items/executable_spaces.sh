#!/bin/bash

# Add the aerospace events we specified in aerospace.toml
sketchybar --add event aerospace_workspace_change
sketchybar --add event aerospace_node_moved

source "$HOME/.config/aerospace/workspaces.conf"
source "$CONFIG_DIR/space_styles.sh"

for sid in $ALL_WORKSPACES; do
  sketchybar --add item space."$sid" left \
    --subscribe space."$sid" mouse.entered mouse.exited \
    --set space."$sid" \
    drawing=off \
    padding_left=$SPACE_PADDING_LEFT_ICON \
    padding_right=$SPACE_PADDING_RIGHT_ICON \
    icon="${sid:1}" \
    label.padding_right=$LABEL_ICON_PADDING_RIGHT \
    label.padding_left=$LABEL_ICON_PADDING_LEFT \
    icon.font.size=$SPACE_ICON_FONT_SIZE \
    icon.padding_left=$SPACE_ICON_PADDING_LEFT \
    icon.padding_right=$SPACE_ICON_PADDING_RIGHT_ICON \
    background.drawing=on \
    label.font="$LABEL_ICON_FONT" \
    background.color="$TRANSPARENT" \
    icon.color="$ACCENT_COLOR" \
    label.color="$ACCENT_COLOR" \
    background.corner_radius=$SPACE_BG_CORNER_RADIUS \
    background.height=$SPACE_BG_HEIGHT \
    label.drawing=on \
    click_script="aerospace workspace $sid" \
    script="$CONFIG_DIR/plugins/aerospace.sh $sid"
done

sketchybar --add item space_separator left \
  --set space_separator icon="" \
  icon.y_offset=$SEPARATOR_ICON_Y_OFFSET \
  icon.padding_left=$SEPARATOR_ICON_PADDING_LEFT \
  label.drawing=off \
  background.drawing=off \
  script="$PLUGIN_DIR/space_windows.sh" \
  --subscribe space_separator aerospace_workspace_change front_app_switched space_windows_change aerospace_node_moved system_woke

# Load labels on startup using the same logic as the plugin
"$PLUGIN_DIR/space_windows.sh"
