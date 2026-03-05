---
description: Push the current branch and create a draft PR with AI-generated title/description
---
Push the current branch and create a draft GitHub PR.

Steps:
1. Detect the VCS in use (jj or git).
2. Ensure changes are committed. Check for uncommitted changes:
   - **jj**: if `jj diff` shows changes, grab recent commit messages as style examples, write a message matching their conventions, and `jj commit -m "<message>"`
   - **git**: if `git diff --cached` or `git status --porcelain` shows changes, stage with `git add -A`, write a message matching recent commit conventions, and `git commit -m "<message>"`
3. Push the branch:
   - **jj**: `jj git push --allow-new`
   - **git**: `git push -u origin HEAD`
4. Gather context for the PR:
   - **Commit descriptions**:
     - **jj**: `jj log -r 'trunk()..@-' --no-graph -T 'description ++ "\n---\n"'`
     - **git**: `git log --format='%B---' origin/main..HEAD` (adjust base branch as needed)
   - **Diff stat**:
     - **jj**: `jj diff -r 'trunk()..@-' --stat`
     - **git**: `git diff --stat origin/main..HEAD`
   - **PR template**: check the repo for `.github/pull_request_template.md` (and common variants)
   - **Recent PR titles**: `gh pr list --state merged --limit 10 --json title --jq '.[].title'`
5. Write a PR title and description:
   - Title: one concise line, no prefix like "PR:", match the style of recent PR titles
   - Description: summarize what changed and why based on the commits
   - If a PR template exists, follow its structure; fill sections from commits/diff, use N/A for irrelevant sections, TODO for unknown info
   - Keep it concise — no filler, no restating the title in the body
6. Create the draft PR:
   ```
   gh pr create --draft --title "<title>" --body "<description>"
   ```
7. Print the PR URL.

$@
