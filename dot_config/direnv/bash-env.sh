# Sourced via BASH_ENV in non-interactive bash sessions so that
# direnv variables (like GH_CONFIG_DIR) are available outside
# interactive shells, e.g. in editor/agent tool calls.
#
# Interactive shells use `direnv hook bash` instead, which triggers
# via PROMPT_COMMAND. Non-interactive bash has no prompt, so we
# trigger the hook at startup and after cd/pushd/popd.
#
# BASH_ENV= prefix on direnv calls prevents recursion: direnv spawns
# bash to evaluate .envrc, and that child must not re-enter this file.

command -v direnv >/dev/null 2>&1 || return 0

_direnv_hook() {
    local previous_exit_status=$?
    eval "$(BASH_ENV= direnv export bash 2>/dev/null)"
    return $previous_exit_status
}

# Load .envrc for the initial working directory.
_direnv_hook

# In non-interactive shells, PROMPT_COMMAND never fires.
# Wrap directory-changing builtins so direnv re-evaluates on cd.
if [[ $- != *i* ]]; then
    cd()    { builtin cd    "$@" && _direnv_hook; }
    pushd() { builtin pushd "$@" && _direnv_hook; }
    popd()  { builtin popd  "$@" && _direnv_hook; }
fi
