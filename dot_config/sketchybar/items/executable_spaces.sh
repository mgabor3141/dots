#!/bin/bash

sketchybar --add item aerospace_mode left \
  --subscribe aerospace_mode aerospace_mode_change \
  --set aerospace_mode icon="" \
  script="$CONFIG_DIR/plugins/aerospace_mode.sh" \
  icon.color="$ACCENT_COLOR" \
  icon.padding_left=4 \
  drawing=off

# Add the aerospace events we specified in aerospace.toml
sketchybar --add event aerospace_workspace_change
sketchybar --add event aerospace_monitor_change
sketchybar --add event aerospace_node_moved

source "$HOME/.config/aerospace/workspaces.conf"
source "$CONFIG_DIR/space_styles.sh"

for sid in $ALL_WORKSPACES; do
  monitor=$(aerospace list-windows --workspace "$sid" --format "%{monitor-appkit-nsscreen-screens-id}")

  if [ -z "$monitor" ]; then
    monitor="1"
  fi

  sketchybar --add item space."$sid" left \
    --subscribe space."$sid" aerospace_workspace_change display_change system_woke mouse.entered mouse.exited \
    --set space."$sid" \
    display="$(
        v=$(aerospace list-windows --workspace "$sid" --format "%{monitor-appkit-nsscreen-screens-id}" | cut -c1)
        echo "${v:-1}"
    )" \
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

# Helper to check if workspace is numbered (for code editors)
is_numbered_workspace() {
  [[ " $NUMBERED_WORKSPACES " == *" $1 "* ]]
}

# Load labels on startup
for mid in $(aerospace list-monitors | cut -c1); do
  for sid in $(aerospace list-workspaces --monitor $mid --empty no); do
    sketchybar --set space.$sid drawing=on

    if is_numbered_workspace "$sid"; then
      # For numbered workspaces: show project name if Zed, otherwise icons
      zed_title=$(aerospace list-windows --workspace "$sid" 2>/dev/null | awk -F'|' '$2 ~ /Zed/ {gsub(/^ *| *$/, "", $3); print $3; exit}')
      
      if [ -n "$zed_title" ]; then
        label=$("$CONFIG_DIR/plugins/zed_project_label.sh" "$zed_title")
        apply_label_style "space.$sid" "$label" "text"
      else
        apps=$(aerospace list-windows --workspace "$sid" | awk -F'|' '{gsub(/^ *| *$/, "", $2); print $2}')
        icon_strip=" "
        if [ -n "$apps" ]; then
          while read -r app; do
            icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
          done <<<"$apps"
        fi
        apply_label_style "space.$sid" "$icon_strip" "icon"
      fi
    else
      # For letter workspaces: always show icons
      apps=$(aerospace list-windows --workspace "$sid" | awk -F'|' '{gsub(/^ *| *$/, "", $2); print $2}')
      icon_strip=" "
      if [ -n "$apps" ]; then
        while read -r app; do
          icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
        done <<<"$apps"
      fi
      apply_label_style "space.$sid" "$icon_strip" "icon"
    fi
  done
done

sketchybar --add item space_separator left \
  --set space_separator icon="" \
  icon.y_offset=$SEPARATOR_ICON_Y_OFFSET \
  icon.padding_left=$SEPARATOR_ICON_PADDING_LEFT \
  label.drawing=off \
  background.drawing=off \
  script="$PLUGIN_DIR/space_windows.sh" \
  --subscribe space_separator aerospace_workspace_change front_app_switched space_windows_change aerospace_monitor_change aerospace_node_moved
