#!/usr/bin/env bash
# bing-wallpaper.sh
# Arch Linux prerequisites: pacman -S --needed curl jq swww util-linux
# Run once at login (e.g., via Niri). It updates immediately, then every hour.

trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

API_URL="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/bing-wallpaper"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-3600}"   # hourly
TICK_SECONDS="${TICK_SECONDS:-10}"             # max delay after wake

mkdir -p "$CACHE_DIR"

update_once() {
  # 1) Fetch JSON (fail fast on HTTP errors)
  json="$(curl -fsSL "$API_URL")"

  # 2) Parse with jq
  urlbase="$(jq -r '.images[0].urlbase' <<<"$json")"
  enddate="$(jq -r '.images[0].enddate' <<<"$json")"              # e.g., 20251024
  title="$(jq -r '.images[0].title // empty' <<<"$json")"
  copyright="$(jq -r '.images[0].copyright // empty' <<<"$json")"
  fallback_rel="$(jq -r '.images[0].url' <<<"$json")"

  # 3) Build URLs (prefer UHD)
  uhd_url="https://www.bing.com${urlbase}_UHD.jpg"
  fallback_url="https://www.bing.com${fallback_rel}"

  # 4) Filename (unique per day; title sanitized)
  safe_title="${title//[^[:alnum:]-_ ]/}"
  name="${enddate}-${safe_title:-bing}-UHD.jpg"
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
    find "$CACHE_DIR" -type f ! -name "$(basename "$outfile")" -delete
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

  # Set via swww with smooth transition
  swww img "${wall_to_use:-$outfile}" \
    --transition-type fade \
    --transition-duration 10 \
    --transition-fps 60
  # ============================================================================ #

  printf "Set wallpaper: %s\n" "$outfile"
  [[ -n "$copyright" ]] && printf "Source: %s\n" "$copyright"
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
