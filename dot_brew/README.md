# Homebrew Package Management

Packages are managed declaratively via `Brewfile.tmpl`. This is the **single source of truth** for all Homebrew formulae, casks, and taps.

## How to add or remove packages

Edit `Brewfile.tmpl` in this directory. On the next `chezmoi apply`, the `run_onchange` script will automatically run `brew bundle install --cleanup --zap`, which:

- Installs anything newly added to the Brewfile
- **Removes** anything not listed (including casks, with `--zap` for thorough cleanup)

Because of `--cleanup --zap`, you should never install packages with `brew install` directly -- they'll be removed on the next apply. Always add them to the Brewfile instead.

## Conditional packages

The Brewfile uses chezmoi's `.managed` data variable (set during `chezmoi init`) to conditionally include packages that differ between managed and unmanaged machines.
