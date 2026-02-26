# Auto-launch tms (tmux session manager) for interactive shells.
#
# Skips when:
#   - Already inside tmux
#   - Non-interactive shell
#   - Running inside an editor terminal that sets TMS_SKIP
#     (e.g. neovim :terminal)
#   - tmux or tms not available

if not status is-interactive
    return
end

if set -q TMUX
    return
end

if set -q TMS_SKIP
    return
end

if not command -q tmux; or not command -q tms
    return
end

exec tms
