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
6. Move or create the appropriate bookmark on `@-` (the commit you just created):
   - Check `jj log -r '@-' -T 'bookmarks'` — if it already has a bookmark, you're done.
   - Check if this repo uses PRs: `gh pr list --state merged --limit 1 --json number --jq length 2>/dev/null` (if >0, or if a `.github/` dir exists, it uses PRs).
   - **PR repos**: Look for an existing `feat/*` bookmark on the branch: `jj log -r 'trunk()..@' -T 'bookmarks' --no-graph`. If one exists, move it: `jj bookmark move <name> --to @-`. If none exists, create one with a short description of the feature: `jj bookmark create feat/<short-description> -r @-`.
   - **Non-PR repos**: Move main forward: `jj bookmark move main --to @-`.

$@
