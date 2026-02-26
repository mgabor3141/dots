# Auto-launch session-manager for interactive shells.
#
# Opt-in: only runs when SESSION_MANAGER=1 is set (by terminal emulator
# config) or when connecting via SSH. This avoids hijacking IDE task
# terminals, embedded shells, and other special-purpose shells.

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

# Skip in Zed task terminals (they set ZED_ROW, regular terminals don't)
if set -q ZED_ROW
    return
end

# Opt-in: terminal emulator sets SESSION_MANAGER=1, or SSH connection
if not set -q SESSION_MANAGER; and not set -q SSH_CONNECTION
    return
end

if not command -q abduco; or not command -q session-manager
    return
end

exec session-manager
