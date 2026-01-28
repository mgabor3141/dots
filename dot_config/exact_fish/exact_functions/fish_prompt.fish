function fish_prompt --description 'Write out the prompt'
        set -l last_status $status
        set -l normal (set_color normal)
        set -l cwd_color (set_color $fish_color_cwd)
        set -l vcs_color (set_color brpurple)
        set -l chevron_normal (set_color blue)
        set -l chevron_color $cwd_color

        # Since we display the prompt on a new line allow the directory names to be longer.
        set -q fish_prompt_pwd_dir_length
        or set -lx fish_prompt_pwd_dir_length 0

        # Determine chevron symbol
        set -l suffix '❯'
        if functions -q fish_is_root_user; and fish_is_root_user
                set suffix '#'
        end

        # Determine chevron color based on history mode
        if test $__history_global_mode -eq 1
                set chevron_color $chevron_normal
        end

        # Mouse indicator
        set -l mouse_indicator ''
        if set -q __fish_mouse_enabled; and test "$__fish_mouse_enabled" -eq 1
                set mouse_indicator ' 🐁'
        end

        # Blank line between commands
        echo ""

        if contains -- --final-rendering $argv
            # Prompt in scrollback
                echo -n -s $chevron_normal $suffix ' ' $normal
        else
            # Active prompt
                if set -q SSH_CONNECTION
                        set_color blue
                        echo -n "["(string replace -r '\.local$' '' (hostname))"] " $normal
                end

                echo -s $cwd_color (prompt_pwd) $vcs_color (fish_vcs_prompt) $normal $mouse_indicator

                if test $last_status -ne 0
                        set_color --background brred
                end

                echo -n -s $chevron_color $suffix $normal ' '
        end
end
