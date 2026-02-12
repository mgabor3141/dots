#!/bin/bash

source "$HOME/.config/aerospace/workspaces.conf"
source "$CONFIG_DIR/space_styles.sh"

# Check if workspace is a numbered workspace (for code editors)
is_numbered_workspace() {
  local ws="$1"
  [[ " $NUMBERED_WORKSPACES " == *" $ws "* ]]
}

# Get Zed project label from window title
get_zed_label() {
  local title="$1"
  "$CONFIG_DIR/plugins/zed_project_label.sh" "$title"
}

# Build label for a numbered workspace
# Shows project name if Zed present, otherwise icons
build_numbered_label() {
  local workspace="$1"
  local windows
  local zed_title=""
  local has_zed=false
  
  windows=$(aerospace list-windows --workspace "$workspace" 2>/dev/null)
  
  # Check for Zed window and get its title
  while IFS='|' read -r id app title; do
    app=$(echo "$app" | xargs)  # trim whitespace
    title=$(echo "$title" | xargs)
    if [ "$app" = "Zed" ]; then
      has_zed=true
      zed_title="$title"
      break
    fi
  done <<< "$windows"
  
  if [ "$has_zed" = true ] && [ -n "$zed_title" ]; then
    # Return project name and signal to use text font
    echo "text:$(get_zed_label "$zed_title")"
  elif [ -n "$windows" ]; then
    # Return icons
    local icon_strip=" "
    while IFS='|' read -r id app title; do
      app=$(echo "$app" | xargs)
      if [ -n "$app" ]; then
        icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
      fi
    done <<< "$windows"
    echo "icon:$icon_strip"
  else
    echo ""
  fi
}

# Build label for a letter workspace (always icons)
build_letter_label() {
  local workspace="$1"
  local windows
  local icon_strip=" "
  
  windows=$(aerospace list-windows --workspace "$workspace" 2>/dev/null | awk -F'|' '{gsub(/^ *| *$/, "", $2); print $2}')
  
  if [ -n "$windows" ]; then
    while read -r app; do
      if [ -n "$app" ]; then
        icon_strip+=" $($CONFIG_DIR/plugins/icon_map_fn.sh "$app")"
      fi
    done <<< "$windows"
    echo "$icon_strip"
  else
    echo ""
  fi
}

# Update a workspace's label in sketchybar
update_workspace_label() {
  local workspace="$1"
  local focused="$2"
  local result label label_type

  if is_numbered_workspace "$workspace"; then
    result=$(build_numbered_label "$workspace")
    if [ -z "$result" ]; then
      # Empty workspace: show if focused, hide otherwise
      if [ "$workspace" = "$focused" ]; then
        sketchybar --set space.$workspace drawing=on label=""
      else
        aerospace move-workspace-to-monitor --workspace "$workspace" 1 2>/dev/null
        sketchybar --set space.$workspace drawing=off display=1
      fi
      return
    fi

    label_type="${result%%:*}"
    label="${result#*:}"

    apply_label_style "space.$workspace" "$label" "$label_type"
  else
    label=$(build_letter_label "$workspace")
    if [ -z "$label" ]; then
      # Empty workspace: show if focused, hide otherwise
      if [ "$workspace" = "$focused" ]; then
        sketchybar --set space.$workspace drawing=on label=""
      else
        aerospace move-workspace-to-monitor --workspace "$workspace" 1 2>/dev/null
        sketchybar --set space.$workspace drawing=off display=1
      fi
      return
    fi
    apply_label_style "space.$workspace" "$label" "icon"
  fi
}

# Refresh all workspaces
update_all_workspaces() {
  local focused
  focused="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused)}"

  for ws in $ALL_WORKSPACES; do
    update_workspace_label "$ws" "$focused"
  done
}

# Handle monitor change
if [ "$SENDER" = "aerospace_monitor_change" ]; then
  sketchybar --set space."$FOCUSED_WORKSPACE" display="$TARGET_MONITOR"
  exit 0
fi

# Workspace switch: only update the two affected workspaces (latency-sensitive)
if [ "$SENDER" = "aerospace_workspace_change" ]; then
  update_workspace_label "$PREV_WORKSPACE" "$FOCUSED_WORKSPACE"
  update_workspace_label "$FOCUSED_WORKSPACE" "$FOCUSED_WORKSPACE"
  exit 0
fi

# Everything else (node_moved, front_app_switched, space_windows_change, etc.):
# full refresh to catch all changes (closed windows, moved windows, etc.)
update_all_workspaces
