"""Focused self-tests for pr_status core logic.

Run with:
    python -m pr_status.selftest
"""

from __future__ import annotations

from .discover import Repo, assign_display_attrs, shorten_repo_name
from .model import (
    CIState,
    DeployState,
    DisplayState,
    PR,
    PRLifecycle,
    ReviewDecision,
    Reviewer,
    ReviewerState,
    parse_reviewers,
)
from .render import render, strip_ticket


def test_display_state_precedence() -> None:
    pr = PR(number=1, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, has_conflicts=True, ci=CIState.FAIL, ci_failed=["build"])
    assert pr.display_state == DisplayState.CI_FAIL

    pr = PR(number=2, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, has_conflicts=True, reviewers=[Reviewer("alice", ReviewerState.PENDING)])
    assert pr.display_state == DisplayState.REVIEW

    pr = PR(number=3, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, review_decision=ReviewDecision.APPROVED, reviewers=[Reviewer("alice", ReviewerState.STALE)])
    assert pr.display_state == DisplayState.APPROVED

    pr = PR(number=4, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, review_decision=ReviewDecision.CHANGES_REQUESTED)
    assert pr.display_state == DisplayState.CHANGES

    pr = PR(number=5, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, reviewers=[Reviewer("alice", ReviewerState.STALE)])
    assert pr.display_state == DisplayState.STALE

    pr = PR(number=6, title="x", url="", repo="r", lifecycle=PRLifecycle.OPEN, reviewers=[Reviewer("alice", ReviewerState.COMMENTED, commented=True)])
    assert pr.display_state == DisplayState.REVISE

    pr = PR(number=7, title="x", url="", repo="r", lifecycle=PRLifecycle.DRAFT, has_conflicts=True)
    assert pr.display_state == DisplayState.DRAFT

    pr = PR(number=8, title="x", url="", repo="r", lifecycle=PRLifecycle.MERGED, deploy=DeployState.PROD)
    assert pr.display_state == DisplayState.PROD


def test_parse_reviewers_stale_vs_revise() -> None:
    # dismissed then commented => revise/commented
    raw = {
        "author": {"login": "me"},
        "reviews": [
            {"author": {"login": "alice"}, "state": "APPROVED"},
            {"author": {"login": "alice"}, "state": "DISMISSED"},
            {"author": {"login": "alice"}, "state": "COMMENTED"},
        ],
        "reviewRequests": [],
    }
    reviewers = parse_reviewers(raw)
    alice = [r for r in reviewers if r.login == "alice"][0]
    assert alice.state == ReviewerState.COMMENTED
    assert alice.commented is True

    # dismissed and nothing after => stale
    raw = {
        "author": {"login": "me"},
        "reviews": [
            {"author": {"login": "bob"}, "state": "APPROVED"},
            {"author": {"login": "bob"}, "state": "DISMISSED"},
        ],
        "reviewRequests": [],
    }
    reviewers = parse_reviewers(raw)
    bob = [r for r in reviewers if r.login == "bob"][0]
    assert bob.state == ReviewerState.STALE

    # re-approved after dismissal => approved
    raw = {
        "author": {"login": "me"},
        "reviews": [
            {"author": {"login": "carol"}, "state": "APPROVED"},
            {"author": {"login": "carol"}, "state": "DISMISSED"},
            {"author": {"login": "carol"}, "state": "APPROVED"},
        ],
        "reviewRequests": [],
    }
    reviewers = parse_reviewers(raw)
    carol = [r for r in reviewers if r.login == "carol"][0]
    assert carol.state == ReviewerState.APPROVED


def test_shorten_repo_name() -> None:
    cases = [
        ("core-apps", "core-apps"),
        ("freeflow-api", "freeflow-api"),
        ("example-backend-service", "e-b-service"),
        ("really_long_underscore_name", "r_l_u_name"),
    ]
    for name, expected in cases:
        got = shorten_repo_name(name)
        assert got == expected, (name, got, expected)
        assert len(got) <= 16


def test_strip_ticket() -> None:
    cases = [
        ("FA-35: Add feature", "Add feature"),
        ("feat(FA-28): add thing", "feat: add thing"),
        ("[FA-28] fix: add stuff", "fix: add stuff"),
        ("PLAT-953: - Bump lib", "Bump lib"),
        ("FA-1: single digit", "single digit"),
    ]
    for title, expected in cases:
        assert strip_ticket(title) == expected, (title, strip_ticket(title), expected)


def test_render_conflicts_are_terminal_only() -> None:
    repos = [
        Repo(name="core-apps", owner_repo="o/core-apps"),
        Repo(name="freeflow-api", owner_repo="o/freeflow-api"),
    ]
    assign_display_attrs(repos)
    prs = [
        PR(
            number=1,
            title="FA-1: Test",
            url="u",
            repo="freeflow-api",
            lifecycle=PRLifecycle.OPEN,
            has_conflicts=True,
            reviewers=[Reviewer("alice", ReviewerState.PENDING)],
        )
    ]
    terminal = "\n".join(render(prs, repos, slack=False))
    assert "🔀 conflicts" in terminal
    assert "👀  review" in terminal

    slack = "\n".join(render(prs, repos, slack=True))
    assert "🔀 conflicts" not in slack
    assert "review" in slack


def main() -> None:
    test_display_state_precedence()
    test_parse_reviewers_stale_vs_revise()
    test_shorten_repo_name()
    test_strip_ticket()
    test_render_conflicts_are_terminal_only()
    print("pr_status self-tests passed")


if __name__ == "__main__":
    main()
