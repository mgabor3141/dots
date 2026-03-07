# Dependencies: qs, noctalia

# Set waybar colors
cat > "$CACHE_DIR/colors.css" <<EOF
@define-color highlight $GRADIENT_FROM;
EOF

# Set niri colors — validate to prevent unparseable config from crashing niri
hex6='^#[0-9a-fA-F]{6}$'
int='^[0-9]+$'
if ! [[ "$GRADIENT_FROM" =~ $hex6 && "$GRADIENT_TO" =~ $hex6 && "$GRADIENT_ANGLE" =~ $int ]]; then
  echo "Refusing to write colors-niri.kdl: invalid values — from=$GRADIENT_FROM to=$GRADIENT_TO angle=$GRADIENT_ANGLE" >&2
  exit 1
fi

cat > "$CACHE_DIR/colors-niri.kdl" <<EOF
layout {
  focus-ring {
      active-gradient from="$GRADIENT_FROM" to="$GRADIENT_TO" angle=$GRADIENT_ANGLE in="oklab"
  }

  insert-hint {
      gradient from="${GRADIENT_FROM}80" to="${GRADIENT_TO}80" angle=$GRADIENT_ANGLE in="oklab"
  }
}
EOF


niri msg -j outputs | jq -r 'keys[]' | while read -r MONITOR; do
  qs -c noctalia-shell ipc call wallpaper set "$IMAGE" "$MONITOR"
done
