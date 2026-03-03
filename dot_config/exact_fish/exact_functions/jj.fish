function jj --wraps jj --description 'jj wrapper that sets the editor for interactive use'
    JJ_EDITOR="zed --wait" command jj $argv
end
