#!/usr/bin/env bash
# bing-wallpaper-hourly.sh
# Arch Linux prerequisites: pacman -S --needed curl jq swww util-linux
# Run once at login (e.g., via Niri). It updates immediately, then every hour.

set -euo pipefail

API_URL="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=de-DE"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/bing-wallpaper"
INTERVAL_SECONDS="${BING_WALLPAPER_INTERVAL_SECONDS:-3600}"  # change via env if you want
LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/bing-wallpaper.lockdir"   # protects overlapping runs

mkdir -p "$CACHE_DIR"

start_swww_daemon() {
  if ! pgrep -x swww-daemon >/dev/null 2>&1; then
    # --format xrgb is broadly compatible; tweak if you prefer
    swww-daemon --format xrgb >/dev/null 2>&1 &
    sleep 0.5
  fi
}

update_once() {
  # lock just this run to avoid overlap if previous run is still busy
  # (flock not needed; mkdir lock works everywhere)
  # if mkdir "$LOCK_DIR" 2>/dev/null; then
  #   trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
  # else
  #   # Another run is in progress; skip
  #   return 0
  # fi

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

  # 6) Ensure daemon and set wallpaper with a smooth transition
  start_swww_daemon
  swww img "$outfile" \
    --transition-type fade \
    --transition-step 255

  printf "Set wallpaper: %s\n" "$outfile"
  [[ -n "$copyright" ]] && printf "Source: %s\n" "$copyright"
}

main() {
  start_swww_daemon

  # Run immediately once
  update_once

  # Then loop hourly in the background if not already backgrounded by caller
  while true; do
    sleep "$INTERVAL_SECONDS"
    update_once
  done
}

main "$@" &
