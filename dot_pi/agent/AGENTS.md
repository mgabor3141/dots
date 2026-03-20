# Global Agent Instructions

**Precedence:** Repo/project AGENTS.md > this file > system prompt. When instructions conflict, the more specific source wins.

## Defaults

- **Pushing/PRs:** Always confirm before pushing, creating PRs, or posting comments externally.
- **Testing:** After changes, run the project's test suite and lint scripts if they exist.

## Verify, Don't Assume

When working on a service or system, don't stop at "it's running". Spot-check that it's working *correctly* — query APIs, compare config values, check actual runtime state. Flag discrepancies even if they're outside the immediate task scope.

## Writing Style

Avoid overusing emdashes. They are a hallmark of "AI slop" and undermine credibility. Prefer commas, semicolons, colons, or separate sentences.

## Summarizing Changes

When summarizing what you've done, indicate the repository state: whether changes are uncommitted, committed, or pushed.

## Maintaining AGENTS.md Files

When editing AGENTS.md files: keep them brief, be proactive about adding critical learnings as you encounter them.
