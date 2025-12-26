#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

sudo systemctl enable --now coolercontrold.service

sudo systemctl enable --now docker.socket
sudo usermod -aG docker $USER

sudo systemctl enable --now nix-daemon
