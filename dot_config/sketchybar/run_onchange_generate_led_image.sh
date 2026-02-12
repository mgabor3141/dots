#!/bin/bash
# Generate the mic-mute LED glow indicator image.
#
# Three composited layers (outer glow → mid glow → bright core) with gaussian
# blur produce a glowing LED strip effect.
#
# This is a run_onchange_ script: it only re-runs when the script content
# changes (chezmoi tracks the hash). We can't use modify_ because ImageMagick's
# blur produces non-deterministic output across process invocations (ASLR
# affects floating-point rounding), causing chezmoi diff to always show changes.
#
# Requires: ImageMagick 7 (magick)
#
# Color reference: matches the waybar mute indicator CSS gradient
#   (dot_config/waybar-mute-indicator/style.css)

set -euo pipefail

target="$HOME/.config/sketchybar/images"
mkdir -p "$target"

magick -size 900x30 xc:none \
  \( -size 900x30 xc:none \
     -fill "rgba(255,0,0,0.7)" -draw "roundrectangle 90,7 809,22 8,8" \
     -blur 12x9 \
  \) -gravity center -composite \
  \( -size 900x30 xc:none \
     -fill "rgba(255,40,40,1)" -draw "roundrectangle 95,10 804,19 5,5" \
     -blur 8x4 \
  \) -gravity center -composite \
  \( -size 900x30 xc:none \
     -fill "rgba(255,200,200,0.95)" -draw "roundrectangle 100,12 799,17 3,3" \
     -blur 6x1 \
  \) -gravity center -composite \
  "$target/mic_mute_led.png"
