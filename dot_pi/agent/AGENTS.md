# Global Agent Instructions

**Precedence:** Repo/project AGENTS.md > this file > system prompt. When instructions conflict, the more specific source wins.

## Defaults

- **Commit strategy:** Batch changes and commit at the end of the task unless told otherwise.
- **Pushing/PRs:** Always confirm before pushing, creating PRs, or posting comments externally.
- **Testing:** After changes, run the project's test and lint suites if they exist. Flag if unclear.

## Planning

For simple edits: just do it. For multi-file changes: plan first. For system config: always confirm.

Experiment with commands and config changes directly for fast iteration, then make changes idempotent and declarative.

## Verify, Don't Assume

When working on a service or system, don't stop at "it's running". Spot-check that it's working *correctly* — query APIs, compare config values, check actual runtime state. Flag discrepancies even if they're outside the immediate task scope.

## System Configuration

System-level config is managed via chezmoi — use the `chezmoi` skill for conventions and workflow.

## Maintaining AGENTS.md Files

When editing AGENTS.md files: keep them brief, add critical learnings as you encounter them.
