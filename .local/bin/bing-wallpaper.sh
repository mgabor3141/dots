#!/usr/bin/env bash
# bing-wallpaper.sh
# Arch Linux prerequisites: pacman -S --needed curl jq swww util-linux
# Run once at login (e.g., via Niri). It updates immediately, then every hour.

trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# MKT="en-US"
# MKT="de-DE"
# MKT="it-IT"
# MKT="ja-JP"
# MKT="es-ES"

# Script arguments
MKT="${1:-en-US}"
DAYS_AGO="${2:-0}"

API_URL="http://localhost:8080/api/colors?locale=${MKT}&daysAgo=${DAYS_AGO}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/bing-wallpaper"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-3600}"   # hourly
TICK_SECONDS="${TICK_SECONDS:-10}"             # max delay after system resume

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$CACHE_DIR"

update_once() {
  # 1) Fetch JSON (fail fast on HTTP errors)
  json="$(curl -fsSL "$API_URL")"

  # 2) Parse with jq
  uhd_url="$(jq -r '.images.UHD' <<<"$json")"
  date="$(jq -r '.date' <<<"$json")"
  title="$(jq -r '.title' <<<"$json")"
  gradient_angle="$(jq -r '.colors.gradient_angle' <<<"$json")"
  gradient_from="$(jq -r '.colors.gradient_from' <<<"$json")"
  gradient_to="$(jq -r '.colors.gradient_to' <<<"$json")"
  copyright="$(jq -r '.copyright' <<<"$json")"

  # 4) Filename (unique per day; title sanitized)
  safe_title="${title//[^[:alnum:]-_ ]/}"
  name="${date}-${safe_title:-bing}.jpg"
  outfile="${CACHE_DIR}/${name}"

  # 5) Download if today's file not present; then clean old files
  if [[ ! -f "$outfile" ]]; then
    tmp="${outfile}.partial"

    # try UHD, then fallback
    if ! curl -fL --retry 3 --retry-delay 1 -o "$tmp" "$uhd_url"; then
      curl -fL --retry 3 --retry-delay 1 -o "$tmp" "$fallback_url"
    fi

    mv "$tmp" "$outfile"

    # Keep only the latest file
    find "$CACHE_DIR" -type f -mtime +2 -delete
  fi

  # === Pretty caption overlay (IMv7) ============================================
  # Config: scale & fonts (change to taste or export in env)
  CAPTION_SCALE="${BING_WALLPAPER_CAPTION_SCALE:-0.8}"   # 0.7 small … 1.0 default … 1.3 big
  CAPTION_FONT_MAIN="${BING_WALLPAPER_FONT_MAIN:-DejaVu-Serif}"
  CAPTION_FONT_BOLD="${BING_WALLPAPER_FONT_BOLD:-DejaVu-Sans}"

  if command -v magick >/dev/null 2>&1; then
    annotated="${outfile%.*}-annotated.jpg"

    # 1) Get base image size
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

    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN

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

    wall_to_use="$annotated"

    # Keep only latest annotated file
    find "$(dirname "$outfile")" -type f -name '*-annotated.jpg' ! -name "$(basename "$annotated")" -delete
  else
    wall_to_use="$outfile"
  fi

  # ============================================================================ #

  # Set blurred image as niri overview backdrop
  blurred="${outfile%.*}-blurred.jpg"
  magick "$outfile" \
    -blur 0x8 \
    \( -size "$(magick identify -format '%wx%h' "$outfile")" radial-gradient:none-black \
       -evaluate multiply 0.5 \) \
    -compose multiply -composite \
    "$blurred"

  killall -q swaybg || true
  swaybg --image "${blurred}" &

  printf "Set wallpaper: %s\n" "$outfile"
  [[ -n "$copyright" ]] && printf "Source: %s\n" "$copyright"

  echo "Highlight color: $gradient_from"

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
    --zen-primary-color: $gradient_from !important;
    --zen-main-browser-background-toolbar:
        linear-gradient(135deg, ${gradient_from}99 0%, transparent 100%),
        linear-gradient(-45deg, ${gradient_to}99 0%, transparent 80%) !important;
    --zen-main-browser-background:
        linear-gradient(135deg, ${gradient_from}99 0%, transparent 100%),
        linear-gradient(-45deg, ${gradient_to}99 0%, transparent 80%) !important;
}
EOF

  # Set main wallpaper via swww with smooth transition
  swww clear-cache
  swww img "${wall_to_use:-$outfile}" \
    --transition-type fade \
    --transition-duration 10 \
    --transition-fps 60
}

main() {
  update_once
  local deadline=$(( $(date +%s) + INTERVAL_SECONDS ))

  while :; do
    local now=$(date +%s)
    if (( now >= deadline )); then
      update_once
      deadline=$(( now + INTERVAL_SECONDS ))
      continue
    fi
    local remaining=$(( deadline - now ))
    local chunk=$(( remaining < TICK_SECONDS ? remaining : TICK_SECONDS ))
    (( chunk > 0 )) && sleep "$chunk"
  done
}

main "$@"
