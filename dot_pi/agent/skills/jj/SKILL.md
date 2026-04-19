---
name: jj
description: >
  Best practices when creating, splitting, squashing, or reordering commits.
---

# jj workflow reference

The **working copy** (represented by the @ symbol) is a concept unique to jj. Changes made to files are automatically tracked as part of whichever changeset (commit) the current working copy points to. This can be a changeset that has "already been committed" in git terms, or it can be one that does not yet have a description on top of other changes. The latter is common, as it can be thought of as a staging area.

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

Unfortunately there is no way to work with individual hunks without the interactive TUI, so only file level filtering is available for operations. You can work around this by selecting a specific changeset with `jj edit` that needs to be modified.

## Common patterns

**Realized @ has two concerns:**
```bash
jj split ...             # what goes to first commit
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

## Tags

- Create/update a tag: `jj tag set <tag> [-r <rev>]`
- jj tags are currently **lightweight only**; no annotated tags.
- `jj git push` pushes **bookmarks**, not tags.
- Best remote workflow:
  1. `jj tag set v1.2.3 -r <rev>`
  2. Push with Git: `git push origin refs/tags/v1.2.3`

## Selectively committing files or hunks

- Think in terms of **moving changes between commits**, not staging.
- For **whole files/paths**, prefer path arguments:
  - `jj commit path/to/file` — keep only that path in the current commit; move the rest to a new working-copy commit.
  - `jj split path/to/file` — extract that path into one commit and leave the rest in the other.
  - `jj squash path/to/file --into <rev>` — move one file/path from `@` into another commit.
  - `jj restore path/to/file --from <rev> --into <other-rev>` — copy whole-file content between revisions.
- For **individual hunks**, there is no great non-interactive path-based command.
- If the changes belong to older commits in the stack, `jj absorb` can often auto-place them into the right ancestors.

## Conflicts

Conflicts are a first class citizen in jj. Conflicted changesets can be moved around and edited like any other changeset. The conflict markers are similar to git's, but give a bit more information about each conflicted hunk.

Resolve conflicts by selecting each conflicted commit with `jj edit` and fixing the conflicts in the working copy. Start from the oldest conflicts, as resolving earlier conflicts might resolve later ones too.
