#!/bin/bash
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Restart xremap when config changes
# {{ include (joinPath .chezmoi.sourceDir "config.yml") | sha256sum }}

systemctl --user daemon-reload
systemctl --user restart xremap.service
