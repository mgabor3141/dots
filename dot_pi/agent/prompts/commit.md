---
description: Generate a commit message and commit (jj)
---
Write a commit message and commit the current changes using jj.

1. Get the diff: `jj diff`
2. Grab recent commit messages as style examples:
   `jj log -r 'trunk()- | trunk()-' --no-graph --limit 10 -T 'description.first_line() ++ "\n"'`
3. Before creating a new commit, consider whether the changes belong in an existing one:
   - Review branch commits: `jj log -r 'trunk()..@'`. If the changes are a small fix or continuation of a recent commit, `jj squash --into <rev>` is cleaner.
   - Force-pushing PR branches is fine — rebasing does it anyway. A clean history matters more.
   - When in doubt, prefer a clean atomic history over many small fixup commits.
4. Write a concise commit description:
   - First line: short summary in imperative mood, no trailing period
   - If needed, add a blank line then a brief body explaining *why*, not *what*
   - Match the style and conventions of the example commits
5. `jj commit -m "<message>"`
   - After committing, check if a bookmark is on `@--` (the parent before the commit). If so, move it forward: `jj bookmark move <name> --to @-`

$@
