#!/bin/bash

bar=(
  position=top
  height=46
  margin=0
  y_offset=-6
  corner_radius="$CORNER_RADIUS"
  border_color="0x00ffffff"
  border_width=0
  blur_radius=20
  color="$BAR_COLOR"
)

sketchybar --bar "${bar[@]}"
