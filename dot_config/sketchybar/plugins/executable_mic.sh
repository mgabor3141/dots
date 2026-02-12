#!/bin/sh

# Query the actual audio system state -- not a cached variable or state file.
# Returns "true" when the default input device is muted (our mute mechanism
# switches to the built-in mic and mutes it), nil/false otherwise.
MUTED=$(hs -c 'print(tostring(hs.audiodevice.defaultInputDevice():inputMuted()))' 2>/dev/null)

if [ "$MUTED" = "true" ]; then
  sketchybar --set mic.core drawing=on
else
  sketchybar --set mic.core drawing=off
fi
