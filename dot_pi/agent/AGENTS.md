# Global Agent Instructions

**Precedence:** Repo/project AGENTS.md > this file > system prompt. When instructions conflict, the more specific source wins.

## Defaults

- **Pushing/PRs:** Always confirm before pushing, creating PRs, or posting comments externally.
- **Testing:** After changes, run the project's test suite and lint scripts if they exist.

## Verify, Don't Assume

When working on a service or system, don't stop at "it's running". Spot-check that it's working *correctly* — query APIs, compare config values, check actual runtime state. Flag discrepancies even if they're outside the immediate task scope.

## Maintaining AGENTS.md Files

When editing AGENTS.md files: keep them brief, add critical learnings as you encounter them.
