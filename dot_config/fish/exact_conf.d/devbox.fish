# Fish-native equivalent of the devbox-global PATH/XDG_DATA_DIRS prepend that
# lives in ~/.profile for POSIX shells. Same idempotent semantics: prepend the
# devbox global profile dirs if they exist and aren't already first.
#
# (See dot_profile.tmpl for the rationale on not using `devbox global
# shellenv`: shellenv's stateful path stack clobbers PATH on re-source in
# nested login shells.)

set -l _dbx "$HOME/.local/share/devbox/global/default/.devbox/nix/profile/default"
if test -d "$_dbx/bin"
    fish_add_path --prepend --move "$_dbx/bin"
    if not contains -- "$_dbx/share" $XDG_DATA_DIRS
        set -gx XDG_DATA_DIRS "$_dbx/share" $XDG_DATA_DIRS /usr/local/share /usr/share
    end
end
