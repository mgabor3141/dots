# Per-directory history with global history backup
# Each directory gets its own history session, but all commands are also saved
# to a global history for cross-directory searching.
#
# History files:
#   - Directory-specific: ~/.local/share/fish/<directory_name>_history
#   - Global: ~/.local/share/fish/fish_history
#
# Toggle between modes with: history-toggle (Ctrl+G)

# Track whether we're in global mode
set -g __history_global_mode 0

function __auto_history_chpwd --on-event fish_prompt
    # Only auto-switch if not in global mode
    if test $__history_global_mode -eq 0
        set -g fish_history (echo $PWD | sed -e 's;[^[:alnum:]];_;g')
    end
end

function __save_to_both_histories --on-event fish_postexec
    set -l current_dir_history (echo $PWD | sed -e 's;[^[:alnum:]];_;g')
    
    if test "$fish_history" = "fish"
        # We're in global mode, save to directory history
        set -g fish_history $current_dir_history
        history append -- $argv[1]
        set -g fish_history fish
    else
        # We're in session mode, save to global history
        set -g fish_history fish
        history append -- $argv[1]
        set -g fish_history $current_dir_history
    end
end

function history-toggle --description "Toggle between per-directory and global history"
    # Save the current command if it was typed in (not from history browsing)
    set -l saved_command ""
    if not commandline --search-mode
        set saved_command (commandline)
    end
    
    if test $__history_global_mode -eq 0
        # Switch to global mode
        set -g __history_global_mode 1
        set -g fish_history fish
    else
        # Switch to per-directory mode
        set -g __history_global_mode 0
        set -g fish_history (echo $PWD | sed -e 's;[^[:alnum:]];_;g')
    end
    
    # Clear the command line to reset history search context
    commandline -f kill-whole-line
    
    # Restore the command if it was manually typed
    if test -n "$saved_command"
        commandline -- $saved_command
    end
    
    # Repaint to update chevron color
    commandline -f repaint
end

# Bind Cmd+G to toggle history mode
bind \cg history-toggle
