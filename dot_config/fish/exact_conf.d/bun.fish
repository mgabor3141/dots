# Bun's global bin (where 'bun install -g' lands its shims, e.g. pi).
# Idempotent: fish_add_path is a no-op if the path is already present.
if test -d "$HOME/.bun/bin"
    fish_add_path --prepend --move "$HOME/.bun/bin"
end
