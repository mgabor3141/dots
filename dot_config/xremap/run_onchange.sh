#!/bin/bash
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Restart xremap when config changes
systemctl --user daemon-reload
systemctl --user restart xremap.service
