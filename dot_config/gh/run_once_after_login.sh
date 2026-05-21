#!/bin/bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Warn-only: do not block chezmoi apply by triggering an interactive
# device-flow login. Non-interactive environments (containers, CI,
# first-run bootstrap) would hang forever otherwise.
if ! gh auth status >/dev/null 2>&1; then
    echo "⚠️  gh is not authenticated. Run: gh auth login"
fi
