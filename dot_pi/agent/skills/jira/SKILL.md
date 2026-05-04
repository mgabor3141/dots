---
name: jira
description: >
  Read, search, transition, and comment on tickets at <your-org>.atlassian.net.
  Use when the user references a ticket key (PROJ-1, PLAT-918), asks about
  sprint/board state, or wants to update status or comments.
---

# Jira (Atlassian Cloud)

[`ankitpokhrel/jira-cli`](https://github.com/ankitpokhrel/jira-cli), already
authenticated. Default project `PROJ`; override with `-p<KEY>`. Discover
commands via `jira --help`.

## Writes

Comments and transitions appear under Gabor's account. Discuss first, then
act, and prefix comment bodies with `[AGENT]`. Don't create issues or epics
without explicit "yes, file it".

## Recipes

- **My open tickets:** `jira issue list -a"$(jira me)" -s~Done --plain --no-headers --columns KEY,STATUS,SUMMARY`
- **View a ticket:** `jira issue view PROJ-1`

## Non-obvious

- **Parseable output:** `--plain --no-headers --columns KEY,STATUS,SUMMARY` on `jira issue list`. `--plain` is per-subcommand, not global.
- **Negated filters:** `-s~Done` means status != Done. Same `~` works for other filters.
- **Transitions:** `jira issue move <KEY>` with no target prints the workflow's exact status names.
- **`jira me`** returns the email, not the `accountId`. Use it directly as `-a"$(jira me)"`.
