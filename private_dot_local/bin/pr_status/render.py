"""Terminal and Slack rendering."""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Optional

from .discover import Repo
from .model import (
    CIState, DisplayState, DISPLAY_META, PR, PRLifecycle,
    ReviewerState, DeployState,
)

BOLD = "\033[1m"
DIM = "\033[2m"
NC = "\033[0m"
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[0;33m"

ANSI_RE = re.compile(r"\033\[[^m]*m")
TICKET_RE = re.compile(r"([A-Z]{2,}-\d+)", re.IGNORECASE)


def strip_ticket(title: str) -> str:
    title = TICKET_RE.sub("", title)
    title = re.sub(r"\(\)\s*", "", title)
    title = re.sub(r"\[\]\s*", "", title)
    # Strip leading punctuation that was attached to the ticket ID
    title = title.strip()
    title = re.sub(r"^[:\-\s]+", "", title)
    return title.strip()


def osc8(url: str, label: str) -> str:
    return f"\033]8;;{url}\033\\{label}\033]8;;\033\\"


# ============================================================
# Reviewer icons
# ============================================================

REVIEWER_ICONS = {
    ReviewerState.APPROVED: f"{GREEN}✅{NC}",
    ReviewerState.CHANGES_REQUESTED: f"{RED}🔴{NC}",
    ReviewerState.STALE: f"{YELLOW}♻️{NC}",
    ReviewerState.COMMENTED: "💬",
    ReviewerState.PENDING: f"{DIM}⏳{NC}",
}


def render_reviewer(r) -> str:
    """Render a single reviewer with their state icon."""
    icons = [REVIEWER_ICONS[r.state]]
    # Add comment indicator if they've commented but their main state is something else
    if r.commented and r.state not in (ReviewerState.COMMENTED, ReviewerState.PENDING):
        icons.append("💬")
    return " ".join(icons) + " " + r.login


# ============================================================
# Main render
# ============================================================


def render(
    all_prs: list[PR],
    repos: list[Repo],
    slack: bool,
) -> list[str]:
    lines: list[str] = []
    repo_short = {r.name: r.short_name for r in repos}
    repo_color = {r.name: r.color for r in repos}
    max_repo_len = max((len(s) for s in repo_short.values()), default=10) + 1
    repo_order = {r.name: i for i, r in enumerate(sorted(repos, key=lambda r: r.name))}

    # Group by ticket
    groups: OrderedDict[str, list[PR]] = OrderedDict()
    ungrouped: list[PR] = []
    active = [pr for pr in all_prs if pr.lifecycle != PRLifecycle.CLOSED]

    for pr in active:
        ticket = pr.ticket
        if ticket:
            groups.setdefault(ticket, []).append(pr)
        else:
            ungrouped.append(pr)

    # Sort: open/draft features first, then by recency
    def has_open(prs: list[PR]) -> bool:
        return any(p.lifecycle in (PRLifecycle.OPEN, PRLifecycle.DRAFT) for p in prs)

    open_g = [(t, p) for t, p in groups.items() if has_open(p)]
    done_g = [(t, p) for t, p in groups.items() if not has_open(p)]
    open_g.sort(key=lambda kv: max(p.created_at for p in kv[1]), reverse=True)
    done_g.sort(key=lambda kv: max(p.merged_at or p.created_at for p in kv[1]), reverse=True)
    sorted_groups = open_g + done_g
    ungrouped.sort(key=lambda p: p.merged_at or p.created_at, reverse=True)

    def render_pr_line(pr: PR) -> str:
        short = repo_short.get(pr.repo, pr.repo)
        color = repo_color.get(pr.repo, "")
        title = strip_ticket(pr.title)
        if len(title) > 60:
            title = title[:57] + "..."

        ds = pr.display_state
        emoji, label, ansi = DISPLAY_META[ds]
        padded = label.ljust(9)
        repo_pad = short.ljust(max_repo_len)

        # Build detail parts
        detail_parts: list[str] = []

        # Conflicts are orthogonal: show as extra terminal-only detail
        if pr.has_conflicts and not slack:
            detail_parts.append(f"{RED}🔀 conflicts{NC}")

        # Reviewers
        if pr.reviewers:
            reviewer_strs = [render_reviewer(r) for r in pr.reviewers]
            if slack:
                detail_parts.append("  ".join(ANSI_RE.sub("", s) for s in reviewer_strs))
            else:
                detail_parts.append("  ".join(reviewer_strs))

        # CI
        if pr.ci == CIState.FAIL and ds != DisplayState.CI_FAIL:
            names = ", ".join(pr.ci_failed[:2])
            detail_parts.append(f"CI: {names}" if slack else f"{RED}CI:{NC} {names}")
        elif pr.ci == CIState.FAIL and ds == DisplayState.CI_FAIL:
            names = ", ".join(pr.ci_failed[:2])
            detail_parts.append(f"CI: {names}" if slack else f"{RED}CI:{NC} {names}")
        elif pr.ci == CIState.PENDING:
            detail_parts.append("CI pending" if slack else f"{YELLOW}CI pending{NC}")

        detail = "  ".join(detail_parts)

        if slack:
            line = f"{emoji} `{padded}| {repo_pad}|`  {title}  [#{pr.number}]({pr.url})"
            if detail:
                line += f"  {detail}"
        else:
            pr_link = osc8(pr.url, f"#{pr.number}")
            ts = f"\033[{ansi}m{emoji}  {padded}{NC}"
            line = f"  {ts}  {color}{repo_pad}{NC}  {DIM}{title}{NC}  {pr_link}"
            if detail:
                line += f"  {detail}"
        return line

    def render_header(ticket: str, title: str) -> list[str]:
        if slack:
            return ["", f"*{ticket}: {title}*"]
        return ["", f"{BOLD}{ticket}: {title}{NC}"]

    def render_collapsed(prs: list[PR]) -> str:
        refs = []
        for pr in prs:
            short = repo_short.get(pr.repo, pr.repo)
            color = repo_color.get(pr.repo, "")
            if slack:
                refs.append(f"{short} [#{pr.number}]({pr.url})")
            else:
                refs.append(f"{color}{short}{NC} {osc8(pr.url, f'#{pr.number}')}")
        ref_str = "  ".join(refs)
        if slack:
            return f"✅ All in prod: {ref_str}"
        return f"  {GREEN}✅  All in prod{NC}  {ref_str}"

    def all_prod(prs: list[PR]) -> bool:
        return all(p.deploy == DeployState.PROD for p in prs)

    for ticket, prs in sorted_groups:
        prs.sort(key=lambda p: (repo_order.get(p.repo, 99), 0 if p.lifecycle in (PRLifecycle.OPEN, PRLifecycle.DRAFT) else 1))

        top_repo = prs[0].repo
        top_prs = sorted(
            [p for p in prs if p.repo == top_repo],
            key=lambda p: p.created_at or p.merged_at,
        )
        header_title = strip_ticket(top_prs[0].title)
        if len(header_title) > 70:
            header_title = header_title[:67] + "..."

        lines.extend(render_header(ticket, header_title))
        if all_prod(prs):
            lines.append(render_collapsed(prs))
        else:
            for pr in prs:
                lines.append(render_pr_line(pr))

    if ungrouped:
        lines.append("")
        lines.append("*Other*" if slack else f"{BOLD}Other{NC}")
        if all_prod(ungrouped):
            lines.append(render_collapsed(ungrouped))
        else:
            for pr in ungrouped:
                lines.append(render_pr_line(pr))

    if slack:
        lines = [f"> {line}" if line.strip() else line for line in lines]

    return lines
