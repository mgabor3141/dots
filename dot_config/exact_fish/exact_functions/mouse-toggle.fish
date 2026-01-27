function mouse-toggle
    # Only allow toggling if fish_mouse_enable env var is set
    if not set -q fish_mouse_enable
        return
    end

    # Check if mouse tracking is currently enabled by checking a global variable
    if not set -q __fish_mouse_enabled
        set -g __fish_mouse_enabled 0
    end

    if test "$__fish_mouse_enabled" -eq 1
        # Disable mouse tracking
        printf '\e[?1000l'  # Disable mouse tracking
        printf '\e[?1006l'  # Disable SGR extended mouse mode
        set -g __fish_mouse_enabled 0
        commandline -f repaint
    else
        # Enable mouse tracking
        printf '\e[?1000h'  # Enable mouse tracking (button press/release)
        printf '\e[?1006h'  # Enable SGR extended mouse mode
        set -g __fish_mouse_enabled 1
        commandline -f repaint
    end
end
