#!/usr/bin/env bash
# bing-wallpaper.sh by mgabor
# Dependencies:
#   curl jq imagemagick swww util-linux
# Run once at login (via systemd, cron, autostart, or your desktop environment config)
# Make sure you start the two swww-daemons too

trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

for cmd in curl jq swww magick date; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing dependency: $cmd" >&2; exit 1; }
done

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/bing-wallpaper"
mkdir -p "$CACHE_DIR"

exec 9>"$CACHE_DIR/.lock"
flock -n 9 || { echo "Another instance is running." >&2; exit 0; }

# Script arguments
MKT="${1:-en-US}"
DAYS_AGO="${2:-0}"

# How often to check if it's a new day, this is the max delay after system resume
TICK_SECONDS="${TICK_SECONDS:-30}"

# API_URL="http://localhost:8080/api/colors?locale=${MKT}&daysAgo=${DAYS_AGO}"
API_URL="https://dailyhues.mgabor.hu/api/colors?locale=${MKT}&daysAgo=${DAYS_AGO}"

ONE_DAY=$((24 * 60 * 60))
declare -g next_wallpaper=0

update_once() {
  # 1) Fetch JSON
  json="$(curl -sSL \
    --connect-timeout 5 --max-time 15 \
    --retry 5 \
    --retry-delay 120 \
    --retry-all-errors \
    "$API_URL")"

  # 2) Parse with jq
  uhd_url="$(jq -r '.images.UHD // empty' <<<"$json")"
  startdate="$(jq -r '.startdate // empty' <<<"$json")"
  fullstartdate="$(jq -r '.fullstartdate // empty' <<<"$json")"
  title="$(jq -r '.title // empty' <<<"$json")"
  gradient_angle="$(jq -r '.colors.gradient_angle // empty' <<<"$json")"
  gradient_from="$(jq -r '.colors.gradient_from // empty' <<<"$json")"
  gradient_to="$(jq -r '.colors.gradient_to // empty' <<<"$json")"
  copyright="$(jq -r '.copyright // empty' <<<"$json")"

  # 4) Filename (unique per day; title sanitized)
  safe_title="${title//[^[:alnum:] _-]/}"
  name="${startdate}-${safe_title:-bing}.jpg"
  outfile="${CACHE_DIR}/${name}"

  # 5) Download if today's wallpaper if not present; then clean old files
  if [[ ! -f "$outfile" ]]; then
    echo "Downloading new wallpaper..."
    tmp="${outfile}.partial"
    curl --retry 3 --retry-delay 2 -o "$tmp" "$uhd_url"
    mv "$tmp" "$outfile"

    # Clean old files
    find -- "$CACHE_DIR" -type f -mtime +2 -delete
  fi

  # === Pretty caption overlay (IMv7) ============================================
  # Config: scale & fonts (change to taste or export in env)
  CAPTION_SCALE="${BING_WALLPAPER_CAPTION_SCALE:-0.8}"   # 0.7 small … 1.0 default … 1.3 big
  CAPTION_FONT_MAIN="${BING_WALLPAPER_FONT_MAIN:-DejaVu-Serif}"
  CAPTION_FONT_BOLD="${BING_WALLPAPER_FONT_BOLD:-DejaVu-Sans}"

  annotated="${outfile%.*}-annotated.jpg"

  # If the annotated file doesn't exist, create it
  if [[ ! -f "$annotated" ]]; then
    (
      # Clean up temp dir if we exit this section (return or error)
      set -Eeuo pipefail
      tmpdir="$(mktemp -d)"
      trap 'rm -rf "$tmpdir"' EXIT

      # 1) Get base image size
      # `|| true` is needed because `read` returns the number of characters read
      read -r W H < <(magick identify -format '%w %h' "$outfile") || true

      # 2) Derive sizes from width (looks good on 1080p–4K). The scale applies to all.
      #    Title ~ W/80 at 4K -> 48pt; Body ~ 60% of title; Padding ~ 1.5% of W
      TITLE_PT=$(printf '%.0f\n' "$(awk -v W="$W" -v S="$CAPTION_SCALE" 'BEGIN{v=W/80*S; if(v<22)v=22; print v}')")
      BODY_PT=$(printf '%.0f\n'  "$(awk -v T="$TITLE_PT" 'BEGIN{print (T*0.60)}')")
      PAD=$(printf '%.0f\n'      "$(awk -v W="$W" -v S="$CAPTION_SCALE" 'BEGIN{v=W*0.01*S; if(v<18)v=18; print v}')")
      GAP=$(printf '%.0f\n'      "$(awk -v T="$TITLE_PT" 'BEGIN{print (T*0.4)}')")  # space between title/body
      # Max caption width: scaled fraction of image width (wraps lines; box never exceeds text width)
      MAX_W=$(printf '%.0f\n'    "$(awk -v W="$W" -v S="$CAPTION_SCALE" 'BEGIN{f=0.62+0.18*(S-1); if(f<0.50)f=0.50; if(f>0.80)f=0.80; print W*f}')" )

      # 3) Compose title/body as separate images so we can use different sizes
      cap_title="${title:-Bing Wallpaper}"
      cap_body="${copyright:-}"

      title_png="$tmpdir/title.png"
      body_png="$tmpdir/body.png"
      text_png="$tmpdir/text.png"
      mask_full="$tmpdir/mask-full.png"
      panel_png="$tmpdir/panel.png"

      # Title (wrap to MAX_W)
      magick -background none -fill white \
             -font "$CAPTION_FONT_BOLD" -pointsize "$TITLE_PT" -gravity northwest \
             -size "${MAX_W}x" caption:"$cap_title" \
             -trim +repage "$title_png"

      # Body (smaller font, wrap to MAX_W)
      magick -background none -fill white \
             -font "$CAPTION_FONT_MAIN" -pointsize "$BODY_PT" -gravity northwest \
             -size "${MAX_W}x" caption:"$cap_body" \
             -trim +repage "$body_png"

      # Stack with a small transparent gap, then add padding (so panel hugs text)
      magick \( "$title_png" \) \
             \( -size 1x"$GAP" xc:none \) \
             \( "$body_png" \) \
             -background none -append \
             -bordercolor none -border "$PAD" "$text_png"

      # Measure final text box (including padding) to build rounded panel + mask
      # `|| true` is needed because `read` returns the number of characters read
      read -r TW TH < <(magick identify -format '%w %h' "$text_png") || true

      # Panel radius ~ padding, limited nicely
      R=$(printf '%.0f\n' "$(awk -v P="$PAD" 'BEGIN{v=P*0.5; if(v<16)v=16; if(v>48)v=48; print v}')")

      # 4) Position: bottom-left with a comfortable margin (use PAD as margin unit)
      MARGIN_L=$(printf '%.0f\n'  "$(awk -v P="$PAD" 'BEGIN{print (P*2)}')")
      MARGIN_B=$(printf '%.0f\n'  "$(awk -v P="$PAD" 'BEGIN{print (P*4)}')")

      # Convert bottom-left placement to top-left coordinates for drawing
      X0="$MARGIN_L"
      Y0=$(( H - MARGIN_B - TH ))
      X1=$(( X0 + TW - 1 ))
      Y1=$(( Y0 + TH - 1 ))

      # 5) Build a full-size rounded mask where the panel should appear
      magick -size "${W}x${H}" xc:none \
             -fill white -draw "roundrectangle $X0,$Y0 $X1,$Y1 $R,$R" \
             "$mask_full"

      # 6) Create the panel background (rounded rectangle, semi-transparent black)
      magick -size "${TW}x${TH}" xc:none \
             -fill '#000000A6' -draw "roundrectangle 0,0 $((TW-1)),$((TH-1)) $R,$R" \
             "$panel_png"

      # 7) Composite pipeline:
      #    a) Blur the background under the mask area
      #    b) Lay the semi-transparent rounded panel
      #    c) Put the text on top
      magick "$outfile" \
        \( +clone -blur 0x5 \
           \( "$mask_full" \) -compose CopyOpacity -composite \
        \) \
        -compose over -composite \
        \( "$panel_png" \) -gravity northwest -geometry +$X0+$Y0 -compose over -composite \
        \( "$text_png"  \) -gravity northwest -geometry +$X0+$Y0 -compose over -composite \
        "$annotated"
    )
  fi

  # ============================================================================ #

  # Create blurred image for niri overview backdrop
  blurred="${outfile%.*}-blurred.jpg"

  # Create blurred image if it doesn't exist
  if [[ ! -f "$blurred" ]]; then
    magick "$outfile" \
      -blur 0x8 \
      \( -size "$(magick identify -format '%wx%h' "$outfile")" radial-gradient:none-black \
         -evaluate multiply 0.5 \) \
      -compose multiply -composite \
      "$blurred"
  fi

  printf "Setting wallpaper:\n\t%s\n\t%s\n\t%s\n" \
    "${title:-$name}" \
    "${copyright:-[No description]}" \
    "Applying colors: $gradient_from -> $gradient_to ($gradient_angle)"

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

  # Set zen colors
  cat > "$CACHE_DIR/userChrome.css" <<EOF
html#main-window {
    --zen-primary-color: ${gradient_from} !important;
    --zen-main-browser-background:
         linear-gradient(in lab 270deg, rgb(23 23 26 / 25%) 0%, transparent 25%),
         linear-gradient(in lab ${gradient_angle}deg, ${gradient_from}80 20%, ${gradient_to}80 100%),
         linear-gradient(black) !important;
    --zen-main-browser-background-toolbar: var(--zen-main-browser-background) !important;
    --zen-main-browser-background-old: var(--zen-main-browser-background) !important;
    --zen-main-browser-background-toolbar-old: var(--zen-main-browser-background) !important;
}
EOF

# Set kitty colors
cat > "$CACHE_DIR/colors-kitty.conf" <<EOF
color79 ${gradient_from}
color80 ${gradient_to}
EOF
pkill kitty --signal SIGUSR1 || true

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

  next_wallpaper=$((
      $(date -ud "${fullstartdate:0:8} ${fullstartdate:8:2}:${fullstartdate:10:2}" +%s)
      + (DAYS_AGO + 1) * ONE_DAY
    ))

  echo "New wallpaper at: $(date -d "@$next_wallpaper")"

  return 0
}

# Returns only when we have internet
wait_for_internet() {
  local url="https://www.google.com/generate_204"
  local delay="${INTERNET_CHECK_INTERVAL:-5}"
  until curl -fs --connect-timeout 5 --max-time 10 "$url" >/dev/null 2>&1; do
    echo "No internet, retrying in ${delay}s..." >&2
    sleep "$delay"
  done
}


main() {
  while :; do
    local now=$(date -u +%s)
    if (( now > next_wallpaper )); then
      wait_for_internet

      if ! update_once; then
        local extra_wait=30
        echo "Failed to update wallpaper, retrying in $(( TICK_SECONDS + extra_wait ))s" >&2
        sleep $extra_wait
      fi
    fi

    sleep "$TICK_SECONDS"
  done
}

main "$@"
