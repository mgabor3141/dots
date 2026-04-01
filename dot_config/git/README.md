# Git hooks

Git supports global hooks via `core.hooksPath` in the global git config.

When the optional work git identity is configured, this repo sets `core.hooksPath` to `~/.config/git/hooks` and installs a generic hook dispatcher there.

## How the dispatcher works

All standard client-side hook names (`pre-commit`, `commit-msg`, `pre-push`, etc.) are symlinks to a single `hook-dispatcher` script. When Git invokes any hook, the dispatcher:

1. Determines the hook type from its own filename (`basename $0`).
2. Runs any executable scripts in `hooks.d/<hooktype>/` in alphabetical order. If any script fails, the hook aborts.
3. Delegates to the repo-local `.git/hooks/<hooktype>` if it exists and is executable.

This means `core.hooksPath` no longer silently disables repo-local hooks for any hook type.

## Adding a new global hook

Drop an executable script into `hooks.d/<hooktype>/`. For example, to add a global `commit-msg` check:

```
hooks.d/commit-msg/my-check
```

If the optional work git identity is not configured, `core.hooksPath` is left alone and the entire dispatch mechanism stays inactive.

## Work GitHub context guard

When `git_work.github_org` is configured in chezmoi data, `hooks.d/pre-commit/guard-work-context` blocks commits in repositories whose GitHub remotes belong to that org when the shell is still using the default `gh` config dir.

This is a guardrail against committing in a work repo from a shell that is still using the personal `gh` context. It is not a security boundary, since `git commit --no-verify` can bypass it.

## Credential helper

The global git config also uses `gh auth git-credential` for GitHub HTTPS credentials. That means `git fetch`, `pull`, and `push` inherit the same `GH_CONFIG_DIR` split as the `gh` CLI itself.
