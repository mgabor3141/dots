function jj --wraps jj --description 'jj wrapper for interactive use: real editor + colored built-in diff'
    # In an interactive shell we want the rich color-words diff rather than the
    # rtk-condensed default (which is set globally for agent/non-interactive use).
    JJ_EDITOR="zed --wait" command jj --config ui.diff-formatter=:color-words $argv
end
