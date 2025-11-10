#! /bin/bash

SIMPLE_BAR_DIR="$HOME/Library/Application Support/Übersicht/widgets/simple-bar"

ls "$SIMPLE_BAR_DIR" >/dev/null 2>&1 || git clone https://github.com/Jean-Tinland/simple-bar "$SIMPLE_BAR_DIR"

chmod +x "$SIMPLE_BAR_DIR/lib/scripts/init-aerospace.sh"
