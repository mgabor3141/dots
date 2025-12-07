#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

plutil -convert xml1 ~/Library/Preferences/com.apple.HIToolbox.plist
