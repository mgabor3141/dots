#!/bin/bash
options="1 Sleep\n2 Shutdown\n3 Restart\n4 Logout\n5 Cancel"
chosen=$(echo -e "$options" | wofi --no-custom-entry --hide-scroll --insensitive --dmenu --prompt "Power" --width 300 --lines=5 --sort-order="alphabetical")

case $chosen in
  "Shutdown") systemctl poweroff ;;
  "Restart")   systemctl reboot ;;
  "Logout")   niri msg action quit --skip-confirmation ;;
  "Sleep")  systemctl suspend ;;
  "Hibernate") systemctl hibernate ;;
  "Lock")     swaylock ;;
  "Exit")     exit 0 ;;
  *)          exit 1 ;;
esac
