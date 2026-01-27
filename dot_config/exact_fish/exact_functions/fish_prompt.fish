function fish_prompt --description 'Write out the prompt'
        set -l last_status $status
        set -l normal (set_color normal)
        set -l cwd_color (set_color $fish_color_cwd)
        set -l vcs_color (set_color brpurple)
        set -l highlight (set_color blue)
        set -l chevron_color $cwd_color

        # Since we display the prompt on a new line allow the directory names to be longer.
        set -q fish_prompt_pwd_dir_length
        or set -lx fish_prompt_pwd_dir_length 0

        # Determine chevron symbol
        set -l suffix '❯'
        if functions -q fish_is_root_user; and fish_is_root_user
                if set -q fish_color_cwd_root
                        set cwd_color (set_color $fish_color_cwd_root)
                end
                set suffix '#'
        end

        # Determine chevron color based on history mode
        if test $__history_global_mode -eq 1
                set chevron_color (set_color blue)
        else
                set chevron_color $cwd_color
        end

        echo ""

        # Transient prompt (in scrollback)
        if contains -- --final-rendering $argv
                echo -n -s $highlight $suffix ' ' $normal
        # Full prompt (current)
        else
                if set -q SSH_CONNECTION
                        set_color blue
                        echo -n "["(string replace -r '\.local$' '' (hostname))"] "
                        set_color normal
                end

                echo -s $cwd_color (prompt_pwd) $vcs_color (fish_vcs_prompt) $normal
                echo -n -s $chevron_color $suffix ' ' $normal
        end
end
