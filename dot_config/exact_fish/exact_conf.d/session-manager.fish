# Auto-launch session-manager for interactive shells.
#
# Skips when already inside a managed session, non-interactive,
# explicitly disabled, or dependencies missing.

if not status is-interactive
    return
end

if set -q ABDUCO_SESSION; or set -q TMS_SKIP; or set -q TMUX
    return
end

if not command -q abduco; or not command -q session-manager
    return
end

exec session-manager
