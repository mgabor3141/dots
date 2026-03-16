#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR

# Toggle screen recording with gpu-screen-recorder (NVENC hardware encoding).
# First call: select region with slurp and start recording.
# Second call: stop the running recording.
# Recordings are saved to ~/Videos/screenrec/ with timestamps.

OUTDIR="$HOME/Videos/screenrec"

if PID=$(pgrep -f gpu-screen-recorder); then
    # Stop recording — SIGINT triggers graceful shutdown
    kill -INT $PID
    notify-send -t 3000 "Screen Recording" "Recording saved to $OUTDIR"
else
    mkdir -p "$OUTDIR"
    # slurp outputs "X,Y WxH", convert to "WxH+X+Y" for gpu-screen-recorder
    SLURP=$(slurp) || exit 0
    X=$(echo "$SLURP" | cut -d',' -f1)
    REST=$(echo "$SLURP" | cut -d',' -f2)
    Y=$(echo "$REST" | cut -d' ' -f1)
    WH=$(echo "$REST" | cut -d' ' -f2)
    REGION="${WH}+${X}+${Y}"
    FILENAME="$OUTDIR/$(date +%Y-%m-%d_%H-%M-%S).mp4"
    # -k h264: maximum compatibility (Discord, iOS, browsers all support it)
    # -q ultra: highest quality preset
    # -fm vfr: variable framerate (skip unchanged frames)
    # Add -a default_output for desktop audio, -a default_input for mic
    setsid gpu-screen-recorder -w region -region "$REGION" -f 60 -k h264 -q ultra -fm vfr -o "$FILENAME" </dev/null &>/dev/null &
    notify-send -t 3000 "Screen Recording" "Recording started..."
fi
