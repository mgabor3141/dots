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

# All possible workspaces - must match aerospace.toml bindings
# Letter workspaces (sorted first): 1A, 2W, 3R, 4T
# Numbered workspaces (for editors): 51, 62, 73, 84, 95
ALL_WORKSPACES="1A 2W 3R 4T 51 62 73 84 95"

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
    padding_right=0 \
    icon="${sid:1}" \
    label.padding_right=12 \
    label.padding_left=0 \
    icon.font.size=17 \
    icon.padding_left=7 \
    icon.padding_right=0 \
    background.drawing=on \
    label.font="sketchybar-app-font:Regular:13.0" \
    background.color="$TRANSPARENT" \
    icon.color="$ACCENT_COLOR" \
    label.color="$ACCENT_COLOR" \
    background.corner_radius=4 \
    background.height=19 \
    label.drawing=on \
    click_script="aerospace workspace $sid" \
    script="$CONFIG_DIR/plugins/aerospace.sh $sid"
done

# Load Icons on startup
for mid in $(aerospace list-monitors | cut -c1); do
  for sid in $(aerospace list-workspaces --monitor $mid --empty no); do
  apps=$(aerospace list-windows --workspace "$sid" | awk -F'|' '{gsub(/^ *| *$/, "", $2); print $2}')

  sketchybar --set space.$sid drawing=on

  icon_strip=" "
  if [ "${apps}" != "" ]; then
    while read -r app; do
      icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
    done <<<"${apps}"
  else
    icon_strip=""
  fi
  sketchybar --set space.$sid label="$icon_strip"
  done
done

sketchybar --add item space_separator left \
  --set space_separator icon="" \
  icon.y_offset=2 \
  icon.padding_left=6 \
  label.drawing=off \
  background.drawing=off \
  script="$PLUGIN_DIR/space_windows.sh" \
  --subscribe space_separator aerospace_workspace_change front_app_switched space_windows_change aerospace_monitor_change aerospace_node_moved
