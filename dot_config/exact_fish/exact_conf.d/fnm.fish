# See: https://github.com/Schniz/fnm/blob/master/docs/configuration.md
fnm env --use-on-cd --corepack-enabled --version-file-strategy=recursive --resolve-engines --shell fish | source

# Re-prepend ~/.local/bin so npm-global shims take priority over fnm's multishell binaries.
# fnm env prepends its multishell to PATH, which would otherwise shadow our shims.
fish_add_path --move --path ~/.local/bin
