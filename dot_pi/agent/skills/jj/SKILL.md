---
name: jj
description: >
  jj history manipulation: splitting, squashing, reordering commits.
  Use when reorganizing commit history, not for routine commits.
---

# jj workflow reference

## Key commands

| Task | Command |
|------|---------|
| Commit @ and start fresh | `jj commit -m "msg"` |
| Just set/change message | `jj describe -m "msg"` |
| Split @ into two commits | `jj split [filesets]` |
| Fold @ into parent | `jj squash` |
| Fold @ into specific commit | `jj squash --into <rev>` |
| Insert commit in history | `jj new --insert-after <rev>` |
| Move a commit | `jj rebase -r <rev> -A <dest>` |
| Undo last operation | `jj undo` |
| See what's in @ | `jj diff --stat` |
| Recent history | `jj log --limit 5` |

## Stacked PRs

If the repo uses stacked PRs (pi-jj), use the `jj-stacked-pr` skill instead.

## Common patterns

**Realized @ has two concerns:**
```bash
jj split docs/             # docs go to first commit
jj describe -r @- -m "docs: ..."
# @ still has the remaining changes
```

**Fix something in an earlier commit:**
```bash
# Make the fix in @, then squash it into the target
jj squash --into <rev>
```

**Reorder commits:**
```bash
jj rebase -r <rev> -A <new-parent>
```
