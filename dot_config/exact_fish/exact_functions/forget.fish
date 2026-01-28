function forget --description "Delete commands from both history files"
    # Parse arguments
    argparse 'p/prefix' 'c/contains' 'h/help' -- $argv
    or return 1
    
    if set -q _flag_help
        echo "Usage: forget [OPTIONS] PATTERN"
        echo ""
        echo "Delete commands from both history files (directory-specific and global)"
        echo ""
        echo "Options:"
        echo "  -p, --prefix     Match commands starting with PATTERN"
        echo "  -c, --contains   Match commands containing PATTERN"
        echo "  -h, --help       Show this help"
        echo ""
        echo "Without options, uses exact match (fastest)."
        echo ""
        echo "Examples:"
        echo "  forget 'ls -la'              # Delete exact command"
        echo "  forget --prefix 'git'        # Delete all commands starting with 'git'"
        echo "  forget --contains 'password' # Delete commands containing 'password'"
        return 0
    end
    
    # Get pattern
    if test (count $argv) -eq 0
        echo "Error: No pattern provided" >&2
        echo "Usage: forget [OPTIONS] PATTERN" >&2
        return 1
    end
    
    set -l pattern $argv[1]
    
    # Determine match type and call helper
    if set -q _flag_prefix
        __delete_from_both_histories --prefix $pattern
        echo "Forgot all commands starting with: $pattern"
    else if set -q _flag_contains
        __delete_from_both_histories --contains $pattern
        echo "Forgot all commands containing: $pattern"
    else
        # Default: exact match
        __delete_from_both_histories $pattern
        echo "Forgot: $pattern"
    end
end
