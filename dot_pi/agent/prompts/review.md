---
description: Review recent changes for bugs, missed requirements, and loose ends (jj)
---
Review all changes on the current branch or recent commits.

Adopt the perspective of a senior colleague reviewing a PR — not just checking correctness, but questioning design decisions. Revisit assumptions made during implementation. Look beyond "does this solve the task" to "is this the right way to solve it given the existing codebase."

1. Get the full diff and commit log:
   - `jj diff -r 'trunk()..@'` and `jj log -r 'trunk()..@'`
   - If on trunk with no branch, review the last commits relevant to this thread.
2. Read every changed file, including relevant files that are referenced in the changes — don't rely on the diff alone. Understand the surrounding code.
3. Run test and lint scripts if the project has them.
4. Check for:
   - Bugs, logic errors, missing error handling
   - Incomplete work: TODOs, commented-out code, dead code left behind
   - Inconsistencies with surrounding code (naming, patterns, style)
   - Duplication: could an existing function, pattern, or abstraction have been reused or adapted instead of writing new code?
   - Missing tests or docs if the project has them
   - Anything that would break on a clean checkout or after a package update
   - Things that could be improved or simplified, either now or in a followup task
   - Commit history: verify atomic commits that are clear for reviewers to follow

$@
