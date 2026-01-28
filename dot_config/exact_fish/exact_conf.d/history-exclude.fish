# History exclusion system
# Automatically removes specified commands from history after execution

# Add exact commands to exclude
set -g __history_exclude_exact \
    forget-last \
    fl

# Add prefix patterns to exclude (commands starting with these strings)
# Example: 'secret-' will match 'secret-cmd', 'secret-operation', etc.
set -g __history_exclude_prefix \
    "jj desc"

# Add substring patterns to exclude (commands containing these strings)
# Example: 'password' will match any command containing 'password'
set -g __history_exclude_contains

# Event handler that runs after each command to remove excluded commands
function __history_exclude_cleanup --on-event fish_postexec
    set -l cmd $argv[1]
    
    # Check exact matches first (fastest)
    for pattern in $__history_exclude_exact
        if test "$cmd" = "$pattern"
            __delete_from_both_histories $cmd
            return
        end
    end
    
    # Check prefix patterns (starts with)
    for pattern in $__history_exclude_prefix
        if string match -q -- "$pattern*" $cmd
            __delete_from_both_histories $cmd
            return
        end
    end
    
    # Check substring patterns (contains)
    for pattern in $__history_exclude_contains
        if string match -q -- "*$pattern*" $cmd
            __delete_from_both_histories $cmd
            return
        end
    end
end
