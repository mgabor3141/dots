#!/bin/bash

# Get current workspace
current_workspace=$(/opt/homebrew/bin/aerospace list-workspaces --focused)

# Move all PiP windows to current workspace (as defined by the regex)
/opt/homebrew/bin/aerospace list-windows --all --json \
  | jq -r '.[] | select(.["window-title"] | test("^(Picture[- ]in[- ]Picture|Meet - [a-z-]*)$")) | .["window-id"]' \
  | xargs -r -n1 -I{} /opt/homebrew/bin/aerospace move-node-to-workspace --window-id {} "$current_workspace"
