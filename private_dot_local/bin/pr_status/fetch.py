"""Fetch and enrich PRs from GitHub."""

from __future__ import annotations

import json
from typing import Optional

from .model import PR, parse_pr
from .util import run

PR_FIELDS = (
    "number,title,state,isDraft,createdAt,updatedAt,mergedAt,mergeCommit,"
    "headRefName,baseRefName,author,reviews,reviewRequests,"
    "statusCheckRollup,reviewDecision,mergeStateStatus,mergeable,url"
)


def enrich_pr(pr_stub: dict) -> Optional[PR]:
    """Fetch the rich PR details needed for rendering and notifications."""
    result = run(
        [
            "gh", "pr", "view", str(pr_stub["number"]),
            "--repo", pr_stub["_repo"],
            "--json", PR_FIELDS,
        ],
        timeout=30,
    )
    if not result:
        return None

    try:
        raw = json.loads(result)
    except json.JSONDecodeError:
        return None

    return parse_pr(raw, pr_stub["_repo"], list(pr_stub.get("_sources") or []))
