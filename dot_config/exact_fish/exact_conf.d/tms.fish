# Auto-launch tms (terminal session manager) for interactive shells.
#
# Skips when:
#   - Already inside abduco or tmux
#   - Non-interactive shell (scripts, scp, etc.)
#   - TMS_SKIP is set (e.g. neovim :terminal)
#   - Required commands not available

if not status is-interactive
    return
end

# Detect if already inside abduco (abduco sets no env var,
# so we check the process tree for an abduco parent)
if set -q TMUX; or set -q TMS_SKIP
    return
end

if test -n "$ABDUCO_SESSION"
    return
end

if not command -q abduco; or not command -q tms
    return
end

exec tms
