---
description: Push and create a draft PR (jj)
---
Push the current branch and create a draft GitHub PR using jj.

1. If `jj diff` shows uncommitted changes, grab recent commit messages as style examples, write a message matching their conventions, and `jj commit -m "<message>"`.
2. Push: `jj git push --allow-new`
3. Gather context:
   - Commit descriptions: `jj log -r 'trunk()..@-' --no-graph -T 'description ++ "\n---\n"'`
   - Diff stat: `jj diff -r 'trunk()..@-' --stat`
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
