# See: https://github.com/Schniz/fnm/blob/master/docs/configuration.md
# Guarded: hosts that manage node via devbox/nix instead of fnm (e.g. the
# devbox container) don't have fnm on PATH and would otherwise throw on fish
# startup. fnm-based hosts still get the full env setup.
if type -q fnm
    fnm env --use-on-cd --corepack-enabled --version-file-strategy=recursive --resolve-engines --shell fish | source

    # Re-prepend ~/.local/bin so npm-global shims take priority over fnm's
    # multishell binaries. fnm env prepends its multishell to PATH, which
    # would otherwise shadow our shims.
    fish_add_path --move --path ~/.local/bin
end
