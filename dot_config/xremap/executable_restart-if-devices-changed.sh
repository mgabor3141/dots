#!/usr/bin/env bash
set -euo pipefail

state_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/xremap"
state_file="$state_dir/input-devices.sha256"
lock_file="$state_dir/restart-if-devices-changed.lock"
mkdir -p "$state_dir"

# Avoid overlapping timer invocations.
exec 9>"$lock_file"
flock -n 9 || exit 0

# Track only the devices xremap cares about. Include handler event numbers so
# Bluetooth reconnects that rename/recreate evdev nodes are detected.
current_state="$({
  awk '
    /^N: Name="(kanata|Go60)/ { name=$0; show=1 }
    show && /^H: Handlers=/ { print name " " $0; show=0 }
  ' /proc/bus/input/devices
} | sort | sha256sum | awk '{print $1}')"

previous_state=""
if [[ -f "$state_file" ]]; then
  previous_state="$(cat "$state_file")"
fi

if [[ "$current_state" == "$previous_state" ]]; then
  exit 0
fi

printf '%s\n' "$current_state" > "$state_file"

# First run just seeds state. Don't restart on login before xremap has started.
if [[ -z "$previous_state" ]]; then
  exit 0
fi

# Bluetooth devices often appear in stages. Wait briefly, then restart once.
sleep 2
systemctl --user restart xremap.service
