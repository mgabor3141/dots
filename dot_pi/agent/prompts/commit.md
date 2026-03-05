---
description: Generate a commit message and commit staged/pending changes
---
Write a commit message and commit the current changes.

Steps:
1. Detect the VCS in use (jj or git).
2. Get the diff of pending changes:
   - **jj**: `jj diff`
   - **git**: `git diff --cached` (staged changes). If nothing is staged, stage everything with `git add -A` first.
3. Grab recent commit messages as style examples:
   - **jj**: `jj log -r 'trunk()- | trunk()-' --no-graph --limit 10 -T 'description.first_line() ++ "\n"'`
   - **git**: `git log --oneline -10`
4. Before creating a new commit, consider whether the changes belong in an existing one:
   - Review recent branch commits (`jj log -r 'trunk()..@'` / `git log --oneline origin/main..HEAD`). If the current changes are a small fix, continuation, or cleanup of a recent commit, squashing is cleaner than a separate commit.
   - Force-pushing PR branches is fine — rebasing does it anyway. A clean history matters more.
   - To squash in **jj**: `jj squash --into <rev>` (squashes @ into the target).
   - To squash in **git**: `git commit --fixup <hash>` then `git rebase -i --autosquash`.
   - When in doubt, prefer a clean atomic history over many small fixup commits.
5. Write a concise commit description:
   - First line: short summary in imperative mood, no trailing period
   - If needed, add a blank line then a brief body explaining *why*, not *what*
   - Match the style and conventions of the example commits
6. Commit:
   - **jj**: `jj commit -m "<message>"`
     - After committing, check if a bookmark is on `@--` (the parent before the commit). If so, move it forward: `jj bookmark move <name> --to @-`
   - **git**: `git commit -m "<message>"`

$@
