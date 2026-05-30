# Wrap long-running commands in gmux sessions.
# Open localhost:8790 to see all sessions, or run `gmux` to open the UI.

if not status is-interactive
    return
end

if not command -q gmux
    return
end

function pi --wraps pi --description 'Run pi in a gmux session'
    gmux pi $argv
end
