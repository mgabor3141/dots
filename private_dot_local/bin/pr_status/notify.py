"""Notification diffing and system notification delivery."""

from __future__ import annotations

import shutil
import subprocess
from typing import Optional

from .model import (
    CIState, DeployState, DisplayState, PR, PRLifecycle,
    ReviewerState,
)
from .render import strip_ticket


def send_notification(title: str, message: str) -> None:
    """Send a system notification."""
    if shutil.which("terminal-notifier"):
        subprocess.run(
            ["terminal-notifier", "-title", title, "-message", message,
             "-sound", "default", "-group", "pr-status"],
            capture_output=True,
        )
    elif shutil.which("osascript"):
        esc = message.replace('"', '\\"')
        subprocess.run(
            ["osascript", "-e", f'display notification "{esc}" with title "{title}"'],
            capture_output=True,
        )
    elif shutil.which("notify-send"):
        subprocess.run(["notify-send", title, message], capture_output=True)


def _short_title(pr: PR) -> str:
    title = strip_ticket(pr.title)
    if len(title) > 50:
        title = title[:47] + "..."
    return title


def diff_and_notify(old_prs: list[PR], new_prs: list[PR]) -> None:
    """Compare two snapshots and send notifications on meaningful changes."""
    old_by_key = {(p.repo, p.number): p for p in old_prs}
    new_by_key = {(p.repo, p.number): p for p in new_prs}

    changes: list[str] = []

    for key, new_pr in new_by_key.items():
        old_pr = old_by_key.get(key)
        title = _short_title(new_pr)

        if not old_pr:
            if "review_requested" in set(new_pr.sources):
                changes.append(f"👀 Review requested: {title}")
            continue

        old_sources = set(old_pr.sources)
        new_sources = set(new_pr.sources)
        if "review_requested" in new_sources and "review_requested" not in old_sources:
            changes.append(f"👀 Review requested: {title}")

        old_ds = old_pr.display_state
        new_ds = new_pr.display_state

        # ---- Aggregate state transitions ----

        if old_ds != new_ds:
            # PR merged or closed
            if new_pr.lifecycle == PRLifecycle.MERGED and old_pr.lifecycle != PRLifecycle.MERGED:
                changes.append(f"✅ Merged: {title}")
                continue
            if new_pr.lifecycle == PRLifecycle.CLOSED and old_pr.lifecycle != PRLifecycle.CLOSED:
                changes.append(f"🚫 Closed: {title}")
                continue

            # CI state transitions
            if new_pr.ci == CIState.FAIL and old_pr.ci != CIState.FAIL:
                names = ", ".join(new_pr.ci_failed[:2])
                changes.append(f"❌ CI failed ({names}): {title}")
            elif old_pr.ci == CIState.FAIL and new_pr.ci != CIState.FAIL:
                changes.append(f"🟢 CI fixed: {title}")

            # Deploy transitions
            if new_ds == DisplayState.PROD and old_ds != DisplayState.PROD:
                changes.append(f"🚀 Deployed to prod: {title}")
            elif new_ds == DisplayState.PREPROD and old_ds not in (DisplayState.PROD, DisplayState.PREPROD):
                changes.append(f"⬆️ Deployed to preprod: {title}")

        # Conflicts are orthogonal to the display state
        if not old_pr.has_conflicts and new_pr.has_conflicts:
            changes.append(f"🔀 Conflicts: {title}")
        elif old_pr.has_conflicts and not new_pr.has_conflicts:
            changes.append(f"✅ Conflicts resolved: {title}")

        # ---- Individual reviewer events (even if aggregate state unchanged) ----

        if new_pr.lifecycle not in (PRLifecycle.OPEN, PRLifecycle.DRAFT):
            continue

        old_reviewers = {r.login: r.state for r in old_pr.reviewers}
        for r in new_pr.reviewers:
            old_state = old_reviewers.get(r.login)
            if old_state == r.state:
                continue

            if r.state == ReviewerState.APPROVED and old_state != ReviewerState.APPROVED:
                changes.append(f"✅ {r.login} approved: {title}")
            elif r.state == ReviewerState.CHANGES_REQUESTED and old_state != ReviewerState.CHANGES_REQUESTED:
                changes.append(f"🔴 {r.login} requested changes: {title}")
            elif r.state == ReviewerState.STALE and old_state != ReviewerState.STALE:
                changes.append(f"♻️ {r.login} review dismissed: {title}")
            elif r.state == ReviewerState.COMMENTED and old_state not in (ReviewerState.COMMENTED, None):
                changes.append(f"💬 {r.login} commented: {title}")

    if changes:
        send_notification("pr-status", "\n".join(changes[:5]))
