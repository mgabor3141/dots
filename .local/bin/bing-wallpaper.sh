#!/usr/bin/env bash
# bing-wallpaper.sh
# Arch Linux prerequisites: pacman -S --needed curl jq swww util-linux
# Run once at login (e.g., via Niri). It updates immediately, then every hour.

trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

API_URL="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/bing-wallpaper"
INTERVAL_SECONDS="${BING_WALLPAPER_INTERVAL_SECONDS:-3600}"  # change via env if you want
LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/bing-wallpaper.lockdir"   # protects overlapping runs

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

  # Render a caption onto the image (non-destructive: writes a sibling file)
  if command -v magick >/dev/null 2>&1; then
    annotated="${outfile%.*}-annotated.jpg"

    # Get image dimensions
    read -r W H < <(magick identify -ping -format '%w %h' "$outfile") || true
    box_w=$(( W * 60 / 100 ))  # Caption box ~60% of width

    # Caption text
    cap_title="${title:-Bing Wallpaper}"
    cap_body="${copyright:-}"
    cap_text="$cap_title\n$cap_body"

    # Draw a semi-transparent black box with white text at bottom-left
    magick "$outfile" \
      \( -size ${box_w}x -background '#00000080' -fill white -gravity northwest \
         -pointsize 48 -interline-spacing 4 caption:"$cap_text" \) \
      -gravity southwest -geometry +80+80 -compose over -composite \
      "$annotated"

    wall_to_use="$annotated"

    # Cleanup older annotated files
    find "$(dirname "$outfile")" -type f -name '*-annotated.jpg' ! -name "$(basename "$annotated")" -delete
  else
    wall_to_use="$outfile"
  fi

  swww img "${wall_to_use:-$outfile}" \
    --transition-type fade \
    --transition-step 255 \
    --transition-fps 24

  printf "Set wallpaper: %s\n" "$outfile"
  [[ -n "$copyright" ]] && printf "Source: %s\n" "$copyright"
}

main() {
  # Run immediately once
  update_once

  # Then loop hourly in the background if not already backgrounded by caller
  while true; do
    sleep "$INTERVAL_SECONDS"
    update_once
  done
}

main "$@"
