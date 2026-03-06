---
description: Push and create a draft PR (git)
---
Push the current branch and create a draft GitHub PR using git.

1. If `git status --porcelain` shows uncommitted changes, stage with `git add -A`, write a commit message matching recent conventions (`git log --oneline -10`), and `git commit -m "<message>"`.
2. Push: `git push -u origin HEAD`
3. Gather context:
   - Commit descriptions: `git log --format='%B---' origin/main..HEAD`
   - Diff stat: `git diff --stat origin/main..HEAD`
   - PR template: check for `.github/pull_request_template.md` and common variants
   - Recent PR titles: `gh pr list --state merged --limit 10 --json title --jq '.[].title'`
4. Write a PR title and description:
   - Title: one concise line, no prefix like "PR:", match the style of recent PR titles
   - Description: summarize what changed and why based on the commits
   - If a PR template exists, follow its structure; fill sections from commits/diff, use N/A for irrelevant sections, TODO for unknown info
   - Keep it concise — no filler, no restating the title in the body
5. `gh pr create --draft --title "<title>" --body "<description>"`
6. Print the PR URL.

$@
