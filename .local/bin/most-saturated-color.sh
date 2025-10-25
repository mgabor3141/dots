#!/usr/bin/env bash
set -euo pipefail

# Usage: ./pick_saturated_palette_color.sh input.jpg [PALETTE_SIZE]
# Requires: ImageMagick 7+ (magick)
# Default palette size: 16
#
# Behavior:
#  - Build a reduced palette, convert each color to HSB.
#  - Filter by Saturation >= 0.5 (50%).
#  - Among remaining colors, select the one with highest Value (Brightness).
#    Ties: higher Saturation, then lexicographically smaller hex.
#  - Compute complement (Hue + 180°, mod 1.0)
#  - VERBOSE=1 -> print per-color S,V for filtered set and export swatch image:
#       Row 1: initial palette
#       Row 2: filtered (S≥50%)
#       Row 3: selected color
#       Row 4: complement color

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <image> [palette_size]" >&2
  exit 1
fi

IMG="$1"
PALETTE_SIZE="${2:-16}"

# 1) Generate a reduced palette and list unique colors as hex codes.
mapfile -t HEXES < <(
  magick "$IMG" -alpha off -colors "$PALETTE_SIZE" +dither -unique-colors -depth 8 txt:- \
  | awk 'match($0, /#[0-9A-Fa-f]{6}/) { print substr($0, RSTART, RLENGTH) }' \
  | sort -u
)

if [[ ${#HEXES[@]} -eq 0 ]]; then
  echo "No colors found." >&2
  exit 1
fi

best_hex=""
best_sat="-1"
best_val="-1"

VERBOSE="${VERBOSE:-0}"

FILTERED_HEXES=()

for hex in "${HEXES[@]}"; do
  # 2) Convert each hex to HSB
  csv=$(magick -size 1x1 "xc:$hex" -colorspace HSB \
        -format "%[fx:u.p{0,0}.r],%[fx:u.p{0,0}.g],%[fx:u.p{0,0}.b]" info:)
  IFS=',' read -r H S V <<< "$csv"

  # Filter: keep only S ≥ 0.5
  if awk -v s="$S" 'BEGIN{exit (s>=0.5)?0:1}'; then
    FILTERED_HEXES+=("$hex")
    (( VERBOSE == 1 )) && printf "%s  H=%.3f  S=%.3f  V=%.3f\n" "$hex" "$H" "$S" "$V"

    # Choose by highest Value, then higher Saturation, then lexicographically smaller hex
    if [[ "$best_hex" == "" ]]; then
      best_hex="$hex"; best_sat="$S"; best_val="$V"
    else
      if awk -v v="$V" -v bv="$best_val" 'BEGIN{exit (v>bv)?0:1}'; then
        best_hex="$hex"; best_sat="$S"; best_val="$V"
      elif awk -v v="$V" -v bv="$best_val" -v s="$S" -v bs="$best_sat" 'BEGIN{
          if (v==bv && s>bs) exit 0; else exit 1
        }'; then
        best_hex="$hex"; best_sat="$S"; best_val="$V"
      elif awk -v v="$V" -v bv="$best_val" -v s="$S" -v bs="$best_sat" 'BEGIN{
          exit (v==bv && s==bs)?0:1
        }'; then
        if [[ "$hex" < "$best_hex" ]]; then
          best_hex="$hex"; best_sat="$S"; best_val="$V"
        fi
      fi
    fi
  fi
done

if [[ -z "$best_hex" ]]; then
  echo "No palette colors met S ≥ 50%." >&2
  if (( VERBOSE == 1 )); then
    :
  else
    exit 2
  fi
fi

# 4) Compute complement color by rotating hue 180°
complement_hex=""
if [[ -n "$best_hex" ]]; then
  complement_hex=$(
    magick -size 1x1 "xc:$best_hex" \
      -modulate 100,100,33 \
      -colorspace sRGB -depth 8 -format "#%[hex:u.p{0,0}]" info:
  )
fi

echo "$complement_hex"

# -------- Swatch export (verbose mode) --------
if (( VERBOSE == 1 )); then
  echo "Selected color:   $best_hex"
  echo "Complement color: $complement_hex"
fi

  build_row() {
    local out="$1"; shift
    if (( $# == 0 )); then
      magick -size 60x60 xc:none "$out"
      return
    fi
    local args=()
    for h in "$@"; do
      args+=(-size 60x60 "xc:$h")
    done
    magick "${args[@]}" +append -bordercolor black -border 1 "$out"
  }

  tmpdir=$(mktemp -d)
  row1="$tmpdir/row_initial.png"
  row2="$tmpdir/row_filtered.png"
  row3="$tmpdir/row_selected.png"
  row4="$tmpdir/row_complement.png"

  build_row "$row1" "${HEXES[@]}"
  build_row "$row2" "${FILTERED_HEXES[@]}"
  [[ -n "$best_hex" ]] && build_row "$row3" "$best_hex" || build_row "$row3"
  [[ -n "$complement_hex" ]] && build_row "$row4" "$complement_hex" || build_row "$row4"

  OUT_SWATCH="${IMG%.*}_swatch.png"
  magick "$row1" "$row2" "$row3" "$row4" -append "$OUT_SWATCH"
