#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR

# Toggle screen recording with gpu-screen-recorder (NVENC hardware encoding).
# First call: select region with slurp and start recording.
# Second call: stop the running recording.
# Recordings are saved to ~/Videos/screenrec/ with timestamps.
#
# Usage: screenrec.sh [--audio]
#   --audio: also capture desktop audio (default_output) and mic (default_input)

OUTDIR="$HOME/Videos/screenrec"
AUDIO=false

for arg in "$@"; do
    case "$arg" in
        --audio) AUDIO=true ;;
    esac
done

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

    # Downscale output to 50% of selected region
    W=$(echo "$WH" | cut -d'x' -f1)
    H=$(echo "$WH" | cut -d'x' -f2)
    SW=$(( W / 2 ))
    SH=$(( H / 2 ))
    # Ensure even dimensions (required by h264)
    SW=$(( SW - SW % 2 ))
    SH=$(( SH - SH % 2 ))

    FILENAME="$OUTDIR/$(date +%Y-%m-%d_%H-%M-%S).mp4"

    AUDIO_ARGS=()
    if $AUDIO; then
        AUDIO_ARGS=(-a default_output -a default_input)
    fi

    # -k h264: maximum compatibility (Discord, iOS, browsers all support it)
    # -q ultra: highest quality preset
    # -fm vfr: variable framerate (skip unchanged frames)
    # -s: downscale to 50% of selected region
    setsid gpu-screen-recorder -w region -region "$REGION" -s "${SW}x${SH}" -f 60 -k h264 -q ultra -fm vfr "${AUDIO_ARGS[@]}" -o "$FILENAME" </dev/null &>/dev/null &

    if $AUDIO; then
        notify-send -t 3000 "Screen Recording" "Recording started (with audio)..."
    else
        notify-send -t 3000 "Screen Recording" "Recording started..."
    fi
fi
