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
LOGFILE="/tmp/gpu-screen-recorder.log"
PIDFILE="/tmp/gpu-screen-recorder.pid"
REGIONFILE="/tmp/gpu-screen-recorder.region"
AUDIO=false

for arg in "$@"; do
    case "$arg" in
        --audio) AUDIO=true ;;
    esac
done

# Check if a recording is already running via pidfile
if [[ -f "$PIDFILE" ]] && PID=$(< "$PIDFILE") && kill -0 "$PID" 2>/dev/null; then
    # Stop recording — SIGINT triggers graceful shutdown
    kill -INT "$PID"
    # Wait for the process to finish writing
    tail --pid="$PID" -f /dev/null 2>/dev/null &
    wait $! 2>/dev/null || true
    rm -f "$PIDFILE"
    # Check if the log has errors from the session
    if [[ -s "$LOGFILE" ]] && grep -qi 'error\|fail\|fatal' "$LOGFILE" 2>/dev/null; then
        ERR_MSG=$(tail -5 "$LOGFILE")
        notify-send -u critical -t 8000 "Screen Recording" "Recording may have errors:\n$ERR_MSG"
    else
        notify-send -t 3000 "Screen Recording" "Recording saved to $OUTDIR"
    fi
else
    rm -f "$PIDFILE"
    mkdir -p "$OUTDIR"
    # slurp outputs "X,Y WxH", convert to "WxH+X+Y" for gpu-screen-recorder -w
    # Feed last region to slurp as a predefined rectangle for quick re-selection
    SLURP_ARGS=()
    if [[ -f "$REGIONFILE" ]]; then
        SLURP_ARGS=(-B 4040ff40 -b 00000080)
    fi
    SLURP=$(cat "$REGIONFILE" 2>/dev/null | slurp "${SLURP_ARGS[@]}") || exit 0
    X=$(echo "$SLURP" | cut -d',' -f1)
    REST=$(echo "$SLURP" | cut -d',' -f2)
    Y=$(echo "$REST" | cut -d' ' -f1)
    WH=$(echo "$REST" | cut -d' ' -f2)
    REGION="${WH}+${X}+${Y}"

    W=$(echo "$WH" | cut -d'x' -f1)
    H=$(echo "$WH" | cut -d'x' -f2)

    # Downscale to 50% only if the result stays above NVENC minimum (256px per side)
    MIN_DIM=256
    SW=$(( W / 2 ))
    SH=$(( H / 2 ))
    # Ensure even dimensions (required by h264)
    SW=$(( SW - SW % 2 ))
    SH=$(( SH - SH % 2 ))

    SCALE_ARGS=()
    if (( SW >= MIN_DIM && SH >= MIN_DIM )); then
        SCALE_ARGS=(-s "${SW}x${SH}")
    fi

    FILENAME="$OUTDIR/$(date +%Y-%m-%d_%H-%M-%S).mp4"

    AUDIO_ARGS=()
    if $AUDIO; then
        AUDIO_ARGS=(-a default_output -a default_input)
    fi

    # Clear previous log
    : > "$LOGFILE"

    # -k h264: maximum compatibility (Discord, iOS, browsers all support it)
    # -q ultra: highest quality preset
    # -fm vfr: variable framerate (skip unchanged frames)
    setsid gpu-screen-recorder -w "$REGION" "${SCALE_ARGS[@]}" -f 60 -k h264 -q ultra -fm vfr "${AUDIO_ARGS[@]}" -o "$FILENAME" </dev/null &>"$LOGFILE" &
    RECORDER_PID=$!

    # Give the recorder a moment to start (or fail)
    sleep 0.5

    if kill -0 "$RECORDER_PID" 2>/dev/null; then
        echo "$RECORDER_PID" > "$PIDFILE"
        echo "$SLURP" > "$REGIONFILE"
        if $AUDIO; then
            notify-send -t 3000 "Screen Recording" "Recording started (with audio)..."
        else
            notify-send -t 3000 "Screen Recording" "Recording started..."
        fi
    else
        # Recorder already exited — show the error
        ERR_MSG=$(cat "$LOGFILE" 2>/dev/null | tail -10)
        if [[ -z "$ERR_MSG" ]]; then
            ERR_MSG="gpu-screen-recorder exited immediately with no output"
        fi
        notify-send -u critical -t 10000 "Screen Recording Failed" "$ERR_MSG"
    fi
fi
