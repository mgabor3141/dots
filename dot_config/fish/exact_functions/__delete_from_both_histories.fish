function __delete_from_both_histories --description "Delete commands from both history files"
    # Usage: __delete_from_both_histories [--prefix|--contains] PATTERN
    # Default: exact match (fastest)
    
    set -l match_type exact
    set -l pattern
    
    # Parse options
    if test "$argv[1]" = "--prefix"
        set match_type prefix
        set pattern $argv[2]
    else if test "$argv[1]" = "--contains"
        set match_type contains
        set pattern $argv[2]
    else
        set match_type exact
        set pattern $argv[1]
    end
    
    if test -z "$pattern"
        return 1
    end
    
    # Get the current directory's history name
    set -l current_dir_history (echo $PWD | sed -e 's;[^[:alnum:]];_;g')
    set -l original_history $fish_history
    
    # For exact match, delete directly. For prefix/contains, find matches first.
    if test "$match_type" = exact
        # Delete from current history (exact match, case-sensitive)
        history delete --exact --case-sensitive -- $pattern
        
        # Also delete from the other history file
        if test "$fish_history" = "fish"
            set -g fish_history $current_dir_history
            history delete --exact --case-sensitive -- $pattern
            set -g fish_history fish
        else
            set -g fish_history fish
            history delete --exact --case-sensitive -- $pattern
            set -g fish_history $original_history
        end
    else
        # For prefix/contains, find all matches and delete each one
        set -l matches
        if test "$match_type" = prefix
            set matches (history | string match -- "$pattern*")
        else # contains
            set matches (history | string match -- "*$pattern*")
        end
        
        # Delete each match from both histories
        for cmd in $matches
            # Delete from current history
            history delete --exact --case-sensitive -- $cmd
            
            # Also delete from the other history file
            if test "$fish_history" = "fish"
                set -g fish_history $current_dir_history
                history delete --exact --case-sensitive -- $cmd
                set -g fish_history fish
            else
                set -g fish_history fish
                history delete --exact --case-sensitive -- $cmd
                set -g fish_history $original_history
            end
        end
    end
end
