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
- **Transitions:** `jira issue move <KEY>` with no target prints the workflow's exact status names. The `Cancel` entry in the interactive picker aborts the prompt; it is not a workflow state. If you can't delete a stray issue (403), move it to `Done` and rename to `[discard] ...`.
- **`jira me`** returns the email, not the `accountId`. Use it directly as `-a"$(jira me)"`.
- **Comments:** `jira issue comment add <KEY> "body"` takes the body as a positional arg. There is no `--body` flag; `--template -` reads from stdin.

## REST API fallback

When the CLI can't do something (rich descriptions, components, bulk edits), call the REST API directly. The CLI's API token is in the macOS Keychain under `jira-cli`:

```sh
TOKEN=$(security find-generic-password -s jira-cli -w)
curl -s -u "$(jira me):$TOKEN" "https://<your-org>.atlassian.net/rest/api/3/..."
```

Descriptions posted via `/rest/api/3/issue` must be in ADF (Atlassian Document Format), not plain text or markdown.
