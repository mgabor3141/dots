# History exclusion system
# Automatically removes specified commands from history after execution
#
# Add commands to exclude below (one per line)

set -g __history_exclude_patterns \
    forget-last \
    fl

# Event handler that runs after each command to remove excluded commands
function __history_exclude_cleanup --on-event fish_postexec
    # Simple exact match check - fast, no string matching overhead
    for pattern in $__history_exclude_patterns
        if test "$argv[1]" = "$pattern"
            # Delete exact match from both histories
            __delete_from_both_histories $argv[1]
            return
        end
    end
end
