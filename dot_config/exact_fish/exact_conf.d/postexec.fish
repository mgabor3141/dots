# Display command error status after execution
function __fish_postexec_status --on-event fish_postexec
        set -l last_status $status
        
        # Show error if command failed
        if test $last_status -ne 0
                # The status string we want to print (with 1 space margin on the right)
                set -l status_str "  => $last_status"
                set -l status_len (string length -- $status_str)
                
                # Calculate how many spaces to move right (terminal width - status length - 1 for margin)
                set -l move_right (math $COLUMNS - $status_len - 1)
                
                # Move cursor up one line, move to the right position, then print status
                printf '\e[A\e[%dC' $move_right
                set_color $fish_color_error
                printf '%s\n' $status_str
                set_color normal
        end
end
