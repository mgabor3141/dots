#!/bin/bash
# Get current workspace
current_workspace=$(aerospace list-workspaces --focused)
# Move all PiP windows to current workspace (as defined by the regex)
aerospace list-windows --all --json \
  | jq -r '.[] | select(.["window-title"] | test("^(Picture[- ]in[- ]Picture|Meet - [a-z-]*)$")) | .["window-id"]' \
  | xargs -r -n1 -I{} aerospace move-node-to-workspace --window-id {} "$current_workspace"
done
