"""
Core data model for pr-status.

Defines the state types, aggregation rules, and priority ordering.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional


# ============================================================
# State enums
# ============================================================


class PRLifecycle(Enum):
    """Mutually exclusive lifecycle state of a PR."""
    DRAFT = auto()
    OPEN = auto()
    MERGED = auto()
    CLOSED = auto()


class DeployState(Enum):
    """Where a merged PR has been deployed."""
    UNKNOWN = auto()
    MERGED = auto()      # merged but not yet deployed anywhere
    PREPROD = auto()
    PROD = auto()


class ReviewerState(Enum):
    """State of an individual reviewer."""
    PENDING = auto()          # review requested, no response yet
    COMMENTED = auto()        # left comments only
    APPROVED = auto()         # approved
    CHANGES_REQUESTED = auto()  # requested changes
    STALE = auto()            # prior approval dismissed, no activity since


class CIState(Enum):
    """Aggregate CI check status."""
    NONE = auto()
    PENDING = auto()
    PASS = auto()
    FAIL = auto()


class MergeReadiness(Enum):
    """Whether the PR can be merged (from GitHub's perspective)."""
    CLEAN = auto()       # all checks pass, reviews satisfied, no conflicts
    BLOCKED = auto()     # checks or reviews not satisfied
    BEHIND = auto()      # base branch is ahead, needs update
    UNSTABLE = auto()    # checks running or partially failed
    CONFLICTS = auto()   # merge conflicts
    UNKNOWN = auto()


class ReviewDecision(Enum):
    """GitHub's aggregate review decision."""
    APPROVED = auto()
    CHANGES_REQUESTED = auto()
    REVIEW_REQUIRED = auto()
    NONE = auto()  # no review policy configured


class DisplayState(Enum):
    """
    The single most important state to show for a PR.

    Merge conflicts are modeled separately as merge-readiness and displayed as an
    orthogonal indicator when needed; they do not replace the main PR state.
    """
    # Open PR states (priority order)
    CI_FAIL = auto()
    CHANGES = auto()
    STALE = auto()
    REVISE = auto()
    APPROVED = auto()
    REVIEW = auto()
    DRAFT = auto()
    # Merged/deployed states
    PROD = auto()
    PREPROD = auto()
    MERGED = auto()
    # Terminal states
    CLOSED = auto()
    UNKNOWN = auto()


# Display metadata: emoji, label, ANSI color code
DISPLAY_META: dict[DisplayState, tuple[str, str, str]] = {
    DisplayState.CI_FAIL:   ("❌", "ci fail",   "0;31"),  # red
    DisplayState.CHANGES:   ("🔴", "changes",   "0;31"),  # red
    DisplayState.STALE:     ("♻️", "stale",     "0;33"),  # yellow
    DisplayState.REVISE:    ("✏️", "revise",    "0;36"),  # cyan
    DisplayState.APPROVED:  ("✅", "approved",  "0;32"),  # green
    DisplayState.REVIEW:    ("👀", "review",    "0;33"),  # yellow
    DisplayState.DRAFT:     ("📝", "draft",     "2"),     # dim
    DisplayState.PROD:      ("✅", "prod",      "0;32"),  # green
    DisplayState.PREPROD:   ("⬆️", "preprod",   "0;33"),  # yellow
    DisplayState.MERGED:    ("📦", "merged",    "0;34"),  # blue
    DisplayState.CLOSED:    ("🚫", "closed",    "2"),     # dim
    DisplayState.UNKNOWN:   ("❓", "unknown",   "2"),     # dim
}


# ============================================================
# Data types
# ============================================================


@dataclass
class Reviewer:
    login: str
    state: ReviewerState
    commented: bool = False  # has ever commented (orthogonal to state)


@dataclass
class CICheck:
    name: str
    conclusion: Optional[str]  # SUCCESS, FAILURE, None (still running)
    status: str  # COMPLETED, IN_PROGRESS, QUEUED, etc.


@dataclass
class PR:
    """Enriched PR with all derived state."""
    number: int
    title: str
    url: str
    repo: str
    lifecycle: PRLifecycle
    deploy: DeployState = DeployState.UNKNOWN
    review_decision: ReviewDecision = ReviewDecision.NONE
    merge_readiness: MergeReadiness = MergeReadiness.UNKNOWN
    reviewers: list[Reviewer] = field(default_factory=list)
    ci: CIState = CIState.NONE
    ci_failed: list[str] = field(default_factory=list)
    is_draft: bool = False
    created_at: str = ""
    merged_at: str = ""
    has_conflicts: bool = False

    # Raw data for notification diffing
    _raw: dict = field(default_factory=dict, repr=False)

    @property
    def display_state(self) -> DisplayState:
        """Derive the single display state from all inputs."""
        return derive_display_state(self)

    @property
    def ticket(self) -> Optional[str]:
        """Extract ticket ID from title."""
        import re
        m = re.search(r"([A-Z]{2,}-\d+)", self.title, re.IGNORECASE)
        return m.group(1).upper() if m else None


# ============================================================
# State derivation
# ============================================================


def derive_display_state(pr: PR) -> DisplayState:
    """
    Derive the single most important display state for a PR.

    For merged PRs: deploy state takes precedence.
    For open PRs, priority order:
      ci_fail > changes_requested > stale > revise > approved > review > draft

    Merge conflicts are shown separately and do not replace the main state.
    """
    if pr.lifecycle == PRLifecycle.CLOSED:
        return DisplayState.CLOSED

    if pr.lifecycle == PRLifecycle.MERGED:
        return {
            DeployState.PROD: DisplayState.PROD,
            DeployState.PREPROD: DisplayState.PREPROD,
            DeployState.MERGED: DisplayState.MERGED,
            DeployState.UNKNOWN: DisplayState.UNKNOWN,
        }.get(pr.deploy, DisplayState.MERGED)

    # Draft PRs: CI failures matter, otherwise draft
    if pr.lifecycle == PRLifecycle.DRAFT:
        if pr.ci == CIState.FAIL:
            return DisplayState.CI_FAIL
        return DisplayState.DRAFT

    # Open PRs: main priority chain
    if pr.ci == CIState.FAIL:
        return DisplayState.CI_FAIL

    # Review decision from GitHub trumps individual reviewer aggregation
    if pr.review_decision == ReviewDecision.CHANGES_REQUESTED:
        return DisplayState.CHANGES
    if pr.review_decision == ReviewDecision.APPROVED:
        return DisplayState.APPROVED

    # Fall back to individual reviewer states
    reviewer_states = {r.state for r in pr.reviewers}

    if ReviewerState.CHANGES_REQUESTED in reviewer_states:
        return DisplayState.CHANGES
    if ReviewerState.STALE in reviewer_states:
        return DisplayState.STALE

    # Revise: someone commented (not just pending), ball is in author's court
    has_pending = ReviewerState.PENDING in reviewer_states
    has_comments = any(
        r.state == ReviewerState.COMMENTED
        or (r.commented and r.state != ReviewerState.APPROVED)
        for r in pr.reviewers
    )
    if has_comments and not has_pending:
        return DisplayState.REVISE

    if ReviewerState.APPROVED in reviewer_states:
        return DisplayState.APPROVED
    if has_pending:
        return DisplayState.REVIEW

    return DisplayState.REVIEW


# ============================================================
# Parsing from raw GitHub API data
# ============================================================


def parse_pr(raw: dict, repo_name: str) -> PR:
    """Parse a raw GH API PR dict into our model."""
    state = raw.get("state", "")
    is_draft = raw.get("isDraft", False)

    if state == "CLOSED":
        lifecycle = PRLifecycle.CLOSED
    elif state == "MERGED":
        lifecycle = PRLifecycle.MERGED
    elif is_draft:
        lifecycle = PRLifecycle.DRAFT
    else:
        lifecycle = PRLifecycle.OPEN

    # Review decision
    rd_str = raw.get("reviewDecision", "")
    review_decision = {
        "APPROVED": ReviewDecision.APPROVED,
        "CHANGES_REQUESTED": ReviewDecision.CHANGES_REQUESTED,
        "REVIEW_REQUIRED": ReviewDecision.REVIEW_REQUIRED,
    }.get(rd_str, ReviewDecision.NONE)

    # Merge readiness
    ms_str = raw.get("mergeStateStatus", "")
    merge_readiness = {
        "CLEAN": MergeReadiness.CLEAN,
        "BLOCKED": MergeReadiness.BLOCKED,
        "BEHIND": MergeReadiness.BEHIND,
        "UNSTABLE": MergeReadiness.UNSTABLE,
        "DIRTY": MergeReadiness.CONFLICTS,
    }.get(ms_str, MergeReadiness.UNKNOWN)

    mergeable = raw.get("mergeable", "")
    has_conflicts = mergeable == "CONFLICTING"

    # Reviewers
    reviewers = parse_reviewers(raw)

    # CI
    ci, ci_failed = parse_ci(raw)

    return PR(
        number=raw.get("number", 0),
        title=raw.get("title", ""),
        url=raw.get("url", ""),
        repo=repo_name,
        lifecycle=lifecycle,
        review_decision=review_decision,
        merge_readiness=merge_readiness,
        reviewers=reviewers,
        ci=ci,
        ci_failed=ci_failed,
        is_draft=is_draft,
        created_at=raw.get("createdAt", ""),
        merged_at=raw.get("mergedAt", ""),
        has_conflicts=has_conflicts,
        _raw=raw,
    )


def parse_reviewers(raw: dict) -> list[Reviewer]:
    """Parse reviewer states from raw PR data."""
    reviews = raw.get("reviews") or []
    requests = raw.get("reviewRequests") or []
    pr_author = (raw.get("author") or {}).get("login", "")

    # Track latest meaningful state per reviewer (chronological order from API)
    latest: dict[str, str] = {}
    commented: dict[str, bool] = {}

    for r in reviews:
        author = (r.get("author") or {}).get("login", "")
        state = r.get("state", "")
        if not author or author == pr_author or author == "copilot-pull-request-reviewer":
            continue
        if state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[author] = state
        if state == "COMMENTED":
            commented[author] = True
            if latest.get(author) == "DISMISSED":
                latest[author] = "COMMENTED"

    # Pending review requests
    pending_logins: set[str] = set()
    for rr in requests:
        login = rr.get("login", "") or rr.get("name", "")
        if login and login != pr_author:
            pending_logins.add(login)

    # Build reviewer list
    all_logins = set(latest.keys()) | set(commented.keys()) | pending_logins
    result: list[Reviewer] = []

    for login in all_logins:
        state_str = latest.get(login, "")
        is_pending = login in pending_logins
        has_commented = commented.get(login, False)

        if state_str == "APPROVED":
            state = ReviewerState.APPROVED
        elif state_str == "CHANGES_REQUESTED":
            state = ReviewerState.CHANGES_REQUESTED
        elif state_str == "DISMISSED":
            state = ReviewerState.STALE
        elif state_str == "COMMENTED":
            state = ReviewerState.COMMENTED
        elif is_pending:
            state = ReviewerState.PENDING
        else:
            state = ReviewerState.COMMENTED if has_commented else ReviewerState.PENDING

        result.append(Reviewer(login=login, state=state, commented=has_commented))

    return result


def parse_ci(raw: dict) -> tuple[CIState, list[str]]:
    """Parse CI status from raw PR data."""
    checks = raw.get("statusCheckRollup") or []
    checks = [c for c in checks if c.get("name")]
    if not checks:
        return CIState.NONE, []

    failed = [c["name"] for c in checks if c.get("conclusion") == "FAILURE"]
    pending = [c for c in checks if c.get("status") not in ("COMPLETED",) and c.get("name")]

    if failed:
        return CIState.FAIL, failed
    if pending:
        return CIState.PENDING, []
    return CIState.PASS, []
