# Auto-launch session-manager for interactive shells.
#
# Skips when already inside a managed session, non-interactive,
# explicitly disabled, or dependencies missing.

if not status is-interactive
    return
end

# Inside a managed session: remove virgin marker on first command
if set -q ABDUCO_SESSION; and set -q SESSION_NAME
    function __session_manager_mark_used --on-event fish_preexec
        rm -f "$HOME/.abduco/.virgin-$SESSION_NAME"
        functions -e __session_manager_mark_used  # one-shot
    end
    return
end

if set -q TMS_SKIP; or set -q TMUX
    return
end

if not command -q abduco; or not command -q session-manager
    return
end

exec session-manager
