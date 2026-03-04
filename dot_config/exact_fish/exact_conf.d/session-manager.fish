# Wrap long-running commands in persistent abduco sessions via `persist`.
# Detach with Ctrl-\ to return to your shell; the process keeps running.
# Reattach with: session-manager

if not status is-interactive
    return
end

if not command -q persist
    return
end

# Wrap pi in a persistent session.
# Add more wrappers below as needed.
function pi --wraps pi --description 'Run pi in a persistent session'
    persist pi $argv
end
