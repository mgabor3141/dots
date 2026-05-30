#!/usr/bin/env bash
# Applied on every container start: bring the env up to the declared state,
# then exec the requested command. Idempotent and cheap on warm volumes.
set -euo pipefail

if [ -n "${DOTFILES_REPO:-}" ]; then
  if [ -d "$HOME/.local/share/chezmoi/.git" ]; then
    # Already initialized -> pull latest and re-apply.
    chezmoi update --apply || chezmoi apply
  else
    # First run -> clone + apply non-interactively.
    # NOTE: chezmoi keys --promptBool/--promptString on the *prompt string*,
    # not the field name. container=true, headless=false (headless is the
    # separate unraid box and must not be assumed here).
    chezmoi init --apply "$DOTFILES_REPO" \
      --promptBool "managed device=false,headless server=false,container env=true,configure a separate work git identity=false" \
      --promptString "git name=${GIT_NAME:-dev},git email=${GIT_EMAIL:-dev@example.com}"
  fi
fi

# Converge the declarative package set devbox-side (chezmoi just placed the
# devbox.json at devbox's canonical global path).
if command -v devbox >/dev/null; then
  devbox global install || true
fi

exec "$@"
