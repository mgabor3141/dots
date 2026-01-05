#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

dconf write /org/gnome/desktop/interface/color-scheme '"prefer-dark"'
