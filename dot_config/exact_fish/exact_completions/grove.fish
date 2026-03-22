# Completions for grove - workspace manager for jj repos

# Helper: list workspace names by finding directories inside .grove/
function __grove_workspaces
    set -l dir (pwd)
    while test "$dir" != /
        if test -d "$dir/.grove"
            for ws in $dir/.grove/*/
                basename $ws
            end
            return
        end
        set dir (dirname $dir)
    end
end

# Helper: check if a subcommand has been given
function __grove_needs_command
    set -l cmd (commandline -opc)
    for c in $cmd[2..]
        switch $c
            case new sync delete rm list ls status
                return 1
        end
    end
    return 0
end

# Helper: check if the current subcommand matches
function __grove_using_command
    set -l cmd (commandline -opc)
    for c in $cmd[2..]
        switch $c
            case $argv[1]
                return 0
        end
    end
    return 1
end

# Disable file completions
complete -c grove -f

# Subcommands
complete -c grove -n __grove_needs_command -a new    -d 'Create a new workspace'
complete -c grove -n __grove_needs_command -a sync   -d 'Re-sync symlinks for all workspaces'
complete -c grove -n __grove_needs_command -a delete -d 'Delete a workspace'
complete -c grove -n __grove_needs_command -a rm     -d 'Delete a workspace'
complete -c grove -n __grove_needs_command -a list   -d 'List workspaces with status'
complete -c grove -n __grove_needs_command -a ls     -d 'List workspaces with status'
complete -c grove -n __grove_needs_command -a status -d 'Show project and repo overview'

# grove new
complete -c grove -n '__grove_using_command new' -a '(__grove_workspaces)' -d 'Workspace name'
complete -c grove -n '__grove_using_command new' -s y -l yes       -d 'Skip confirmation'
complete -c grove -n '__grove_using_command new' -l editor         -d 'Open in editor'
complete -c grove -n '__grove_using_command new' -l no-editor      -d "Don't open in editor"

# grove delete / rm (complete with workspace names)
complete -c grove -n '__grove_using_command delete' -a '(__grove_workspaces)' -d 'Workspace'
complete -c grove -n '__grove_using_command delete' -s f -l force  -d 'Skip confirmation'
complete -c grove -n '__grove_using_command rm'     -a '(__grove_workspaces)' -d 'Workspace'
complete -c grove -n '__grove_using_command rm'     -s f -l force  -d 'Skip confirmation'
