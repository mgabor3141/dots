#!/bin/bash
options="1 Sleep\n2 Shutdown\n3 Restart\n4 Logout\n5 Cancel"
chosen=$(echo -e "$options" | wofi --no-custom-entry --hide-scroll --insensitive --dmenu --prompt "Power" --width 300 --lines=5 --sort-order="alphabetical")

case $chosen in
  "2 Shutdown")  systemctl poweroff ;;
  "3 Restart")   systemctl reboot ;;
  "4 Logout")    niri msg action quit --skip-confirmation ;;
  "1 Sleep")     systemctl suspend ;;
  "Hibernate")   systemctl hibernate ;;
  "Lock")        swaylock ;;
  "5 Cancel")    exit 0 ;;
  *)             exit 1 ;;
esac
