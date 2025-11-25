#!/bin/bash

bar=(
  position=top
  margin=0
  corner_radius="$CORNER_RADIUS"
  border_color="0x00ffffff"
  border_width=0
  blur_radius=20
  color="$BAR_COLOR"

  height=30
  notch_display_height=48
  notch_offset=-9
)

sketchybar --bar "${bar[@]}"
