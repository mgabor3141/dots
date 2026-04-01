"""Fetch PRs from GitHub."""

from __future__ import annotations

import json
from typing import Optional

from .discover import Repo
from .model import PR, parse_pr
from .util import run

PR_FIELDS = (
    "number,title,state,isDraft,createdAt,mergedAt,mergeCommit,"
    "headRefName,baseRefName,author,reviews,reviewRequests,"
    "statusCheckRollup,reviewDecision,mergeStateStatus,mergeable,url"
)


def fetch_prs(repo: Repo, author: str, since: str) -> list[PR]:
    """Fetch recent PRs for a repo and parse into model objects."""
    env = {"GIT_DIR": repo.git_dir} if repo.git_dir else {}
    result = run(
        ["gh", "pr", "list",
         "--repo", repo.owner_repo,
         "--author", author, "--state", "all", "--limit", "50",
         "--json", PR_FIELDS],
        env=env, timeout=30,
    )
    if not result:
        return []

    try:
        raw_prs = json.loads(result)
    except json.JSONDecodeError:
        return []

    prs = []
    for raw in raw_prs:
        created = raw.get("createdAt", "")
        merged = raw.get("mergedAt", "")
        if created >= since or (merged and merged >= since):
            prs.append(parse_pr(raw, repo.name))
    return prs
