---
name: gmux
description: >
  Run long-lived tasks (tests, builds, dev servers, nested agents) via
  gmux so the user can watch them live in a browser.
---

`gmux -- <cmd>` wraps a command in a managed session the user watches in a
browser. Running a command always uses the explicit `--` separator; bare
`gmux <cmd>` is no longer shorthand (it errors). Tip: `alias gm='gmux --'`.

## Wait for it to finish

```bash
gmux -- <cmd>
```

Blocks until done. Prints ~7 bounded lines on stdout (metadata header + `exited: N` trailer). The child's own output goes to the gmux session, not your stdout. **`$?` is the child's exit code**, so `if gmux -- pytest; then ...` works.

Don't pipe to `tail` unless you've set `pipefail`: a plain `gmux -- <cmd> | tail` swallows the child's exit code (you get `tail`'s 0). If you don't need the metadata, just run `gmux -- <cmd>` and ignore stdout.

## Fire and forget

```bash
id=$(gmux -d -- <cmd>)
```

`-d` (detach) returns immediately, prints the session id on stdout, exit 0 on success. Exits non-zero with a stderr message if the child dies before registering, so `set -e` scripts fail loudly. Use for dev servers, watchers, anything the user will stop themselves, or anything you want to drive afterwards with `tail` / `send` / `wait` / `kill`.

## Check on a running or finished session

```bash
gmux ls                     # short IDs (8 chars), alive first
gmux ls --json              # machine-readable array
gmux tail <id> -n 100       # last 100 lines, ANSI stripped (--raw to keep it)
```

`tail` is a **re-rendered terminal grid, not a byte log**: cursor overwrites
collapse to the final screen, lines wrap at the session's column width, and
trailing spaces are trimmed. It can return at most ~2000 lines (the replay
scrollback ring; on-disk history is capped at ~2 MiB), so `tail -n 100000` will
not give you everything. If a child prints more than that and you need all of
it, capture on the producer side (redirect to a file) instead of relying on
`tail`.

Sessions are **local by default** — a bare id never matches another host. To
address a peer session, suffix it: `gmux tail <id>@<peer>` (`gmux ls --all`
lists peers).

## Delegate to an interactive agent and wait

Keep delegated agents interactive for monitoring and follow-ups. Detach the process, then wait for its current turn:

```bash
id=$(gmux -d -- pi --name investigate-foo "Read $PWD/.memory/handoff-foo.md and proceed.")
gmux wait "$id" --timeout 1800
# Read the requested artifact and continue automatically.
```

`wait` detects idle while leaving Pi alive.

For another turn:

```bash
gmux send --wait --timeout 1800 --follow-up "$id" "Investigate the failing case and update the report."
```

## Drive an interactive session

```bash
gmux send <id> 'pytest -q' Enter    # type text AND submit (Enter is explicit)
gmux send <id> 'foo'                # type without submitting (no trailing key)
gmux send <id> C-c                  # send a control key (interrupt)
```

Submission is explicit now: append `Enter` to submit, omit it to leave the line
unsent. Trailing key names (`Enter`, `Escape`, `C-c`, `Up`, ...) follow tmux.
The typed text is interpreted by the **remote shell**, which may be fish/zsh/bash
— quote accordingly (e.g. fish errors on unmatched globs and quotes differently
than bash).

## Wait for a turn, an exit, or specific output

```bash
gmux wait <id>                              # agent turn finished, or session exited
gmux wait <id> --for-text __DONE__ --timeout 120
gmux wait <id> --for-regex '^\$ $' --timeout 30
```

Plain `gmux wait` blocks until an **AI-agent** session goes idle (turn done) or
the session exits. It does **not** fire on a plain shell prompt — for shell
commands either run blocking (`gmux -- make build`) or wait for expected output
with `--for-text` / `--for-regex`, which poll for you and exit nonzero on
`--timeout`:

```bash
gmux send <id> 'run-thing; echo __DONE__' Enter
gmux wait <id> --for-text __DONE__ --timeout 60
```

Exit codes: `0` matched / idle, `2` session died first, `3` timed out.
