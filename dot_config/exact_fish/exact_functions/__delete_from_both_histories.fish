function __delete_from_both_histories --description "Delete a command from both history files (exact match only)"
    # Usage: __delete_from_both_histories COMMAND
    # Uses exact, case-sensitive match for performance
    
    if test (count $argv) -eq 0
        return 1
    end
    
    set -l command $argv[1]
    
    # Get the current directory's history name
    set -l current_dir_history (echo $PWD | sed -e 's;[^[:alnum:]];_;g')
    set -l original_history $fish_history
    
    # Delete from current history (exact match, case-sensitive)
    history delete --exact --case-sensitive -- $command
    
    # Also delete from the other history file
    if test "$fish_history" = "fish"
        # We're in global mode, also delete from directory history
        set -g fish_history $current_dir_history
        history delete --exact --case-sensitive -- $command
        set -g fish_history fish
    else
        # We're in directory mode, also delete from global history
        set -g fish_history fish
        history delete --exact --case-sensitive -- $command
        set -g fish_history $original_history
    end
end
