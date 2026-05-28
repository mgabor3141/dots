---
name: circleci
description: >
  Inspect and interact with CircleCI pipelines, workflows, and jobs via the
  REST API. Use when the user asks about CI status, failed jobs, pipeline
  history, artifacts, or wants to trigger or cancel a pipeline/workflow.
---

# CircleCI

CircleCI API v2 via `curl`. No CLI installed; all calls go to
`https://circleci.com/api/v2`.

## Auth

```sh
TOKEN=$(security find-generic-password -s circleci -w)
curl -s --header "Circle-Token: $TOKEN" https://circleci.com/api/v2/me
```

Store that `TOKEN=$(...)` line at the top of any multi-step script.

## Project slug

The slug identifies a project: `<vcs>/<org>/<repo>`.

- GitHub OAuth app: `gh/<org>/<repo>`
- GitHub App (newer): `circleci/<org>/<repo>`
- Bitbucket: `bb/<org>/<repo>`

When unsure, fetch a recent pipeline and read `project_slug` from the response.
The slug is URL-safe as-is (no encoding needed for `/`).

## Recipes

### Verify auth
```sh
TOKEN=$(security find-generic-password -s circleci -w)
curl -s --header "Circle-Token: $TOKEN" https://circleci.com/api/v2/me | jq .
```

### Recent pipelines for a project
```sh
SLUG="gh/myorg/myrepo"
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/project/$SLUG/pipeline" | jq '.items[] | {id, number, state, created_at, trigger}'
```

### Workflows for a pipeline
```sh
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/pipeline/$PIPELINE_ID/workflow" | jq '.items[] | {id, name, status, created_at}'
```

### Jobs in a workflow
```sh
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/workflow/$WORKFLOW_ID/job" | jq '.items[] | {id, name, status, job_number}'
```

### Job details
```sh
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/project/$SLUG/job/$JOB_NUMBER" | jq .
```

### Job artifacts
```sh
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/project/$SLUG/$JOB_NUMBER/artifacts" | jq '.items[] | {path, url}'
```

### Trigger a pipeline (default branch)
```sh
curl -s -X POST --header "Circle-Token: $TOKEN" \
  --header "Content-Type: application/json" \
  "https://circleci.com/api/v2/project/$SLUG/pipeline" | jq .
```

### Trigger a pipeline on a specific branch
```sh
curl -s -X POST --header "Circle-Token: $TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"branch":"main"}' \
  "https://circleci.com/api/v2/project/$SLUG/pipeline" | jq .
```

### Cancel a workflow
```sh
curl -s -X POST --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/workflow/$WORKFLOW_ID/cancel" | jq .
```

## Job output / logs

The v2 API does **not** expose raw step output. Use v1.1:

```sh
# Returns an array of step output chunks
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v1.1/project/$VCS_TYPE/$ORG/$REPO/$JOB_NUMBER/output" | jq .
```

`$VCS_TYPE` is `github` or `bitbucket` (not the `gh`/`bb` prefix used in v2).

### My recent pipelines across a org
```sh
curl -s --header "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/pipeline?org-slug=gh/myorg&mine=true" | \
  jq '.items[] | {id, number, state, created_at, project_slug}'
```

### Discover your orgs
```sh
curl -s --header "Circle-Token: $TOKEN" \
  https://circleci.com/api/v2/me/collaborations | jq '.[] | {name, slug}'
```

## Non-obvious

- **Pagination:** responses include `next_page_token`; pass it as `?page-token=<value>` to get the next page. An empty or absent `next_page_token` means you're on the last page.
- **Pipeline states:** `created`, `errored`, `setup-pending`, `setup`, `pending`. Workflow states: `success`, `failed`, `error`, `canceled`, `unauthorized`, `running`, `failing`, `on_hold`, `needs_setup`.
- **`mine=true` requires `org-slug`:** `GET /pipeline?mine=true` errors without it. Use `GET /me/collaborations` to discover your org slugs first.
- **`jq` selection tip:** pipe through `| jq -r` for plain strings, `| jq -c` for compact JSON lines.
- **Finding the slug:** if you only know a pipeline ID, `GET /api/v2/pipeline/<id>` returns `project_slug`.
- **GitHub App vs OAuth:** when in doubt, try both slug prefixes; one will 404.

## Writes

Triggering and cancelling runs on the user's behalf. Discuss before acting; don't rerun or cancel without explicit confirmation.
