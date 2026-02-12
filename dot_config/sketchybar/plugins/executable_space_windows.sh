#!/usr/bin/env bash

source "$HOME/.config/aerospace/workspaces.conf"
source "$CONFIG_DIR/space_styles.sh"
source "$CONFIG_DIR/colors.sh"

# Handle monitor change (no label work needed)
if [ "$SENDER" = "aerospace_monitor_change" ]; then
  sketchybar --set space."$FOCUSED_WORKSPACE" display="$TARGET_MONITOR"
  exit 0
fi

# ---------------------------------------------------------------
# Fast path: aerospace_workspace_change
#
# Workspace switching doesn't change labels — only which workspace
# is highlighted. We receive FOCUSED_WORKSPACE and PREV_WORKSPACE
# from the event, so zero aerospace CLI calls are needed.
#
# The front_app_switched event that follows ~200ms later will do
# a full label refresh if anything changed.
# ---------------------------------------------------------------
if [ "$SENDER" = "aerospace_workspace_change" ]; then
  BATCH_ARGS=()

  # Unfocus previous workspace
  if [ -n "$PREV_WORKSPACE" ]; then
    BATCH_ARGS+=(--set "space.$PREV_WORKSPACE"
      background.color="$TRANSPARENT"
      background.drawing=off
      label.color="$ACCENT_COLOR"
      icon.color="$ACCENT_COLOR"
    )
  fi

  # Focus current workspace (ensure it's visible even if empty)
  if [ -n "$FOCUSED_WORKSPACE" ]; then
    BATCH_ARGS+=(--set "space.$FOCUSED_WORKSPACE"
      drawing=on
      background.color="$ACCENT_COLOR"
      background.drawing=on
      label.color="$BACKGROUND"
      icon.color="$BACKGROUND"
    )
  fi

  if [ ${#BATCH_ARGS[@]} -gt 0 ]; then
    sketchybar "${BATCH_ARGS[@]}"
  fi
  exit 0
fi

# ---------------------------------------------------------------
# Full refresh: front_app_switched, space_windows_change,
#               aerospace_node_moved, or startup (no SENDER)
#
# Rebuilds all labels from scratch. Also sets highlight colors
# so that highlight state is always consistent.
# ---------------------------------------------------------------

# Source only the icon_map function definition (not the invocation at the end)
eval "$(sed -n '/^### START-OF-ICON-MAP/,/^### END-OF-ICON-MAP/p' "$CONFIG_DIR/plugins/icon_map_fn.sh")"

# --- Fetch all window data once ---
ALL_WINDOWS=$(aerospace list-windows --all --format "%{workspace}|%{app-name}|%{window-title}" 2>/dev/null)

# Parse windows into per-workspace associative arrays
declare -A WS_APPS      # workspace -> "app1\napp2\n..."
declare -A WS_ZED_TITLE # workspace -> first Zed window title (numbered ws only)

while IFS='|' read -r ws app title; do
  [ -z "$ws" ] && continue
  ws=$(echo "$ws" | xargs)
  app=$(echo "$app" | xargs)
  title=$(echo "$title" | xargs)

  WS_APPS[$ws]+="$app"$'\n'

  # Track Zed title for numbered workspaces (first one wins)
  if [ -z "${WS_ZED_TITLE[$ws]+x}" ] && [ "$app" = "Zed" ]; then
    WS_ZED_TITLE[$ws]="$title"
  fi
done <<< "$ALL_WINDOWS"

# --- Zed project label computation (inlined from zed_project_label.sh) ---
# Collect all unique Zed project names for shortest-unique-prefix computation
ALL_ZED_PROJECTS=""
for ws in "${!WS_ZED_TITLE[@]}"; do
  title="${WS_ZED_TITLE[$ws]}"
  project="${title%% — *}"
  if [ -n "$project" ]; then
    ALL_ZED_PROJECTS+="$project"$'\n'
  fi
done
ALL_ZED_PROJECTS=$(echo "$ALL_ZED_PROJECTS" | sort -u)

compute_zed_label() {
  local window_title="$1"
  if [ -z "$window_title" ]; then
    echo ":zed:"
    return
  fi

  local project_name="${window_title%% — *}"
  IFS='-' read -ra words <<< "$project_name"
  local candidate=""

  for word in "${words[@]}"; do
    if [ -z "$candidate" ]; then
      candidate="$word"
    else
      candidate="$candidate-$word"
    fi

    local is_unique=true
    while IFS= read -r other; do
      [ -z "$other" ] && continue
      if [ "$other" != "$project_name" ]; then
        if [ "$other" = "$candidate" ] || [[ "$other" == "$candidate-"* ]]; then
          is_unique=false
          break
        fi
      fi
    done <<< "$ALL_ZED_PROJECTS"

    if [ "$is_unique" = true ]; then
      break
    fi
  done

  case "$candidate" in
    chezmoi) echo "dots" ;;
    *)       echo "$candidate" ;;
  esac
}

# --- Determine focused workspace ---
is_numbered_workspace() {
  [[ " $NUMBERED_WORKSPACES " == *" $1 "* ]]
}

FOCUSED="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused)}"

# --- Build sketchybar batch command ---
BATCH_ARGS=()

for ws in $ALL_WORKSPACES; do
  apps="${WS_APPS[$ws]}"
  # Strip trailing newline and check if empty
  apps="${apps%$'\n'}"

  # Highlight: focused workspace gets accent pill, others are transparent
  if [ "$ws" = "$FOCUSED" ]; then
    hl_bg_color="$ACCENT_COLOR"
    hl_bg_drawing="on"
    hl_fg_color="$BACKGROUND"
  else
    hl_bg_color="$TRANSPARENT"
    hl_bg_drawing="off"
    hl_fg_color="$ACCENT_COLOR"
  fi

  if [ -z "$apps" ]; then
    # Empty workspace
    if [ "$ws" = "$FOCUSED" ]; then
      BATCH_ARGS+=(--set "space.$ws"
        drawing=on label=""
        background.color="$hl_bg_color" background.drawing="$hl_bg_drawing"
        label.color="$hl_fg_color" icon.color="$hl_fg_color"
      )
    else
      aerospace move-workspace-to-monitor --workspace "$ws" 1 2>/dev/null
      BATCH_ARGS+=(--set "space.$ws"
        drawing=off display=1
        background.color="$hl_bg_color" background.drawing="$hl_bg_drawing"
        label.color="$hl_fg_color" icon.color="$hl_fg_color"
      )
    fi
    continue
  fi

  if is_numbered_workspace "$ws"; then
    zed_title="${WS_ZED_TITLE[$ws]}"
    if [ -n "$zed_title" ]; then
      # Zed workspace: text label with project name
      label=$(compute_zed_label "$zed_title")
      BATCH_ARGS+=(--set "space.$ws"
        drawing=on
        "label=$label"
        label.font="$LABEL_TEXT_FONT"
        label.padding_left=$LABEL_TEXT_PADDING_LEFT
        label.padding_right=$LABEL_TEXT_PADDING_RIGHT
        label.y_offset=$LABEL_TEXT_Y_OFFSET
        icon.padding_right=$SPACE_ICON_PADDING_RIGHT_TEXT
        padding_left=$SPACE_PADDING_LEFT_TEXT
        padding_right=$SPACE_PADDING_RIGHT_TEXT
        background.color="$hl_bg_color" background.drawing="$hl_bg_drawing"
        label.color="$hl_fg_color" icon.color="$hl_fg_color"
      )
      continue
    fi
  fi

  # Icon label: map each app to its icon
  local_icon_strip=" "
  while IFS= read -r app; do
    [ -z "$app" ] && continue
    icon_map "$app"
    local_icon_strip+=" $icon_result"
  done <<< "$apps"

  BATCH_ARGS+=(--set "space.$ws"
    drawing=on
    "label=$local_icon_strip"
    label.font="$LABEL_ICON_FONT"
    label.padding_left=$LABEL_ICON_PADDING_LEFT
    label.padding_right=$LABEL_ICON_PADDING_RIGHT
    label.y_offset=$LABEL_ICON_Y_OFFSET
    icon.padding_right=$SPACE_ICON_PADDING_RIGHT_ICON
    padding_left=$SPACE_PADDING_LEFT_ICON
    padding_right=$SPACE_PADDING_RIGHT_ICON
    background.color="$hl_bg_color" background.drawing="$hl_bg_drawing"
    label.color="$hl_fg_color" icon.color="$hl_fg_color"
  )
done

# Single sketchybar IPC call for all workspace updates
if [ ${#BATCH_ARGS[@]} -gt 0 ]; then
  sketchybar "${BATCH_ARGS[@]}"
fi
