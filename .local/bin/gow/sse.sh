#!/usr/bin/env bash
set -Eeuo pipefail

# ==== CONFIG ====
SSE_URL="${SSE_URL:-http://localhost/api/v1/events}"
CURL_OPTS="${CURL_OPTS:---unix-socket /var/run/wolf/wolf.sock}"
IDLE_SECS="${IDLE_SECS:-300}"               # 5 min default
WHAT="${WHAT:-sleep}"                       # e.g., "sleep,idle"
WHY="${WHY:-Wolf is active}"                # inhibitor reason
DEFAULT_BACKOFF=1
MAX_BACKOFF=60

# ==== STATE ====
inhib_pid=""
timer_pid=""

cleanup() {
  for p in "${timer_pid:-}" "${inhib_pid:-}"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null || true
    [[ -n "$p" ]] && wait "$p" 2>/dev/null || true
  done
}
trap 'cleanup; kill 0' EXIT INT TERM

start_inhibitor() {
  # Only start if not already running
  if [[ -z "${inhib_pid:-}" ]] || ! kill -0 "$inhib_pid" 2>/dev/null; then
    systemd-inhibit --what="$WHAT" --mode=block --why="$WHY" bash -c 'sleep infinity' &
    inhib_pid=$!
    printf '[%s] idle inhibitor started (pid=%s)\n' "$(date -Is)" "$inhib_pid" >&2
  fi
}

stop_inhibitor() {
  if [[ -n "${inhib_pid:-}" ]] && kill -0 "$inhib_pid" 2>/dev/null; then
    kill "$inhib_pid" 2>/dev/null || true
    wait "$inhib_pid" 2>/dev/null || true
    printf '[%s] idle inhibitor stopped\n' "$(date -Is)" >&2
  fi
  inhib_pid=""
}

reset_idle_timer() {
  # Cancel any running timer and start a new one
  if [[ -n "${timer_pid:-}" ]] && kill -0 "$timer_pid" 2>/dev/null; then
    kill "$timer_pid" 2>/dev/null || true
    wait "$timer_pid" 2>/dev/null || true
  fi
  (
    sleep "$IDLE_SECS"
    # If this fires, we’ve been idle long enough — drop inhibitor
    if [[ -n "$inhib_pid" ]] && kill -0 "$inhib_pid" 2>/dev/null; then
      stop_inhibitor
    fi
  ) &
  timer_pid=$!
}

handle_line() {
  local line="$1"
  [[ -z "$line" || "$line" == :* ]] && return 0   # ignore keepalives
  if [[ "$line" == data:* ]]; then
    start_inhibitor
    reset_idle_timer
  fi
}

stream_once() {
  local headers=(-H "Accept: text/event-stream" -H "Cache-Control: no-cache")

  # Start curl as a coprocess
  coproc CURLPROC { curl -SsfN --no-buffer "${headers[@]}" $CURL_OPTS "$SSE_URL"; }

  # If coproc failed to start
  if [[ -z "${CURLPROC_PID:-}" ]]; then
    return 1
  fi

  # Read lines from coprocess stdout (fd ${CURLPROC[0]})
  # This loop runs in the parent shell, so vars like timer_pid/inhib_pid are shared.
  while IFS= read -r -u "${CURLPROC[0]}" line; do
    handle_line "$line"
  done

  # Ensure the coprocess is terminated and reaped
  kill "${CURLPROC_PID}" 2>/dev/null || true
  wait "${CURLPROC_PID}" 2>/dev/null || true
}

main() {
  stop_inhibitor

  local backoff=$DEFAULT_BACKOFF
  while :; do
    if stream_once; then
      backoff=$DEFAULT_BACKOFF
    fi
    sleep "$backoff"
    (( backoff < MAX_BACKOFF )) && backoff=$(( backoff * 2 ))
    (( backoff > MAX_BACKOFF )) && backoff=$MAX_BACKOFF
  done
}

main
