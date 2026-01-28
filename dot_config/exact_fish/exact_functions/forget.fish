function forget --description "Delete a command from both history files (exact match)"
    if test (count $argv) -eq 0
        echo "Usage: forget COMMAND" >&2
        echo "Delete an exact command from both history files" >&2
        return 1
    end
    
    set -l command $argv[1]
    
    # Delete using helper function
    __delete_from_both_histories $command
    
    echo "Forgot: $command"
end
