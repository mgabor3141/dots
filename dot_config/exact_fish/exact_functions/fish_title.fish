function fish_title --description 'Set terminal title with session name' --argument-names last_command
    set -l dir (prompt_pwd)

    if set -q SESSION_NAME
        if test -n "$last_command"
            echo "[$SESSION_NAME] $last_command"
        else
            echo "[$SESSION_NAME] $dir"
        end
    else
        if test -n "$last_command"
            echo "$dir: $last_command"
        else
            echo "$dir"
        end
    end
end
