---
description: Generate a commit message and commit (git)
---
Write a commit message and commit the current changes using git.

1. Get the diff: `git diff --cached`. If nothing is staged, stage everything with `git add -A` first.
2. Grab recent commit messages as style examples: `git log --oneline -10`
3. Before creating a new commit, consider whether the changes belong in an existing one:
   - Review branch commits: `git log --oneline origin/main..HEAD`. If the changes are a small fix or continuation of a recent commit, squashing is cleaner: `git commit --fixup <hash>` then `git rebase -i --autosquash`.
   - Force-pushing PR branches is fine — rebasing does it anyway. A clean history matters more.
   - When in doubt, prefer a clean atomic history over many small fixup commits.
4. Write a concise commit description:
   - First line: short summary in imperative mood, no trailing period
   - If needed, add a blank line then a brief body explaining *why*, not *what*
   - Match the style and conventions of the example commits
5. `git commit -m "<message>"`

$@
