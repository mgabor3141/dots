# Set $SHELL to fish so tools that spawn the user's preferred shell (gmux,
# tmux, lazygit, etc.) pick fish. Docker exec doesn't set $SHELL; without
# this it stays empty and tools fall back to /bin/sh.
if type -q fish
    set -gx SHELL (command -v fish)
end
