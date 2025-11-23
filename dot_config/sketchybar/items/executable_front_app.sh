#!/bin/bash

sketchybar --add item front_app left \
           --set front_app update_freq=6\
              label.color="$ACCENT_COLOR" \
              icon.color="$ACCENT_COLOR" \
              icon.font="sketchybar-app-font:Regular:13.0" \
              script="$PLUGIN_DIR/front_app.sh" \
           --subscribe front_app front_app_switched mouse.exited.global

              # click_script="$PLUGIN_DIR/sketchymenu/app_menu.sh toggle" \
