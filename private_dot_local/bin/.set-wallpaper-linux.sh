# Dependencies: swww util-linux

# Set waybar colors
cat > "$CACHE_DIR/colors.css" <<EOF
@define-color highlight ${gradient_from};
EOF

# Set niri colors
cat > "$CACHE_DIR/colors-niri.kdl" <<EOF
layout {
  focus-ring {
      active-gradient from="$gradient_from" to="$gradient_to" angle=$gradient_angle in="oklab"
  }

  insert-hint {
      gradient from="${gradient_from}80" to="${gradient_to}80" angle=$gradient_angle in="oklab"
  }
}
EOF

# Wait for swww-daemons
deadline=$(( $(date +%s) + 20 ))
until swww query >/dev/null 2>&1 && swww query --namespace backdrop >/dev/null 2>&1; do
  (( $(date +%s) > deadline )) && {
    echo "Timed out waiting for swww. Ensure both daemons are running, e.g.:
    swww-daemon &
    swww-daemon --namespace backdrop &" >&2
    exit 1
  }
  sleep 0.1
done

# Set main wallpaper via swww with smooth transition
swww clear-cache
swww img "$annotated" \
  --transition-type fade \
  --transition-duration 10 \
  --transition-fps 60
swww img "$blurred" \
  --namespace backdrop \
  --transition-type fade \
  --transition-duration 10 \
  --transition-fps 60
