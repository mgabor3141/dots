function forget-last --description "Remove the previous command from both history files"
    # Get the most recent command
    set -l last_cmd (history --max 1)
    
    if test -z "$last_cmd"
        echo "No previous command to forget"
        return 1
    end
    
    # Delete from both histories
    __delete_from_both_histories $last_cmd
    
    echo "Forgot: $last_cmd"
end
