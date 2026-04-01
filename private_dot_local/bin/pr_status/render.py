"""Terminal and Slack rendering."""

from __future__ import annotations

import re
import shutil
import sys
from collections import OrderedDict

from .discover import Repo
from .model import (
    CIState, DISPLAY_META, PR, PRLifecycle, ReviewerState, DeployState,
)

BOLD = "\033[1m"
DIM = "\033[2m"
NC = "\033[0m"
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[0;33m"

ANSI_RE = re.compile(r"\033\[[^m]*m")
OSC8_RE = re.compile(r"\033\]8;;.*?\033\\")
TICKET_RE = re.compile(r"([A-Z]{2,}-\d+)", re.IGNORECASE)


def strip_ticket(title: str) -> str:
    title = TICKET_RE.sub("", title)
    title = re.sub(r"\(\)\s*", "", title)
    title = re.sub(r"\[\]\s*", "", title)
    title = title.strip()
    title = re.sub(r"^[:\-\s]+", "", title)
    return title.strip()


def strip_formatting(text: str) -> str:
    return ANSI_RE.sub("", OSC8_RE.sub("", text))


def visible_len(text: str) -> int:
    return len(strip_formatting(text))


def truncate_text(text: str, max_len: int) -> str:
    if max_len <= 0:
        return ""
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return "." * max_len
    return text[: max_len - 3] + "..."


def current_terminal_width(slack: bool) -> int:
    if slack or not sys.stdout.isatty():
        return 120
    return max(30, shutil.get_terminal_size(fallback=(120, 24)).columns)


def osc8(url: str, label: str) -> str:
    return f"\033]8;;{url}\033\\{label}\033]8;;\033\\"


REVIEWER_ICONS = {
    ReviewerState.APPROVED: f"{GREEN}✅{NC}",
    ReviewerState.CHANGES_REQUESTED: f"{RED}🔴{NC}",
    ReviewerState.STALE: f"{YELLOW}♻️{NC}",
    ReviewerState.COMMENTED: "💬",
    ReviewerState.PENDING: f"{DIM}⏳{NC}",
}


def render_reviewer(r) -> str:
    icons = [REVIEWER_ICONS[r.state]]
    if r.commented and r.state not in (ReviewerState.COMMENTED, ReviewerState.PENDING):
        icons.append("💬")
    return " ".join(icons) + " " + r.login


def render(
    all_prs: list[PR],
    repos: list[Repo],
    slack: bool,
) -> list[str]:
    lines: list[str] = []
    width = current_terminal_width(slack)
    repo_short = {r.owner_repo: r.short_name or r.name for r in repos}
    repo_color = {r.owner_repo: r.color for r in repos}
    repo_order = {r.owner_repo: i for i, r in enumerate(sorted(repos, key=lambda r: r.owner_repo))}
    max_repo_len = max((len(s) for s in repo_short.values()), default=10) + 1

    status_alias = {
        "review": "review", "approved": "approve", "changes": "changes",
        "draft": "draft", "revise": "revise", "merged": "merged",
        "preprod": "preprod", "prod": "prod", "closed": "closed",
        "ci fail": "ci fail", "unknown": "unknown",
    }
    status_short = {
        "review": "rev", "approved": "ok", "changes": "chg", "draft": "drf",
        "revise": "edit", "merged": "mrg", "preprod": "pre", "prod": "prod",
        "closed": "cls", "ci fail": "fail", "unknown": "unk",
    }
    status_tiny = {
        "review": "r", "approved": "a", "changes": "c", "draft": "d",
        "revise": "e", "merged": "m", "preprod": "p+", "prod": "p",
        "closed": "x", "ci fail": "!", "unknown": "?",
    }

    def status_text(label: str) -> str:
        if width < 52:
            return status_tiny.get(label, label[:1])
        if width < 84:
            return status_short.get(label, label[:3])
        if width < 104:
            return status_alias.get(label, label)
        return label

    def repo_text(name: str) -> str:
        if width < 52:
            return truncate_text(name, 8)
        if width < 72:
            return truncate_text(name, 10)
        if width < 90:
            return truncate_text(name, 12)
        return name

    groups: OrderedDict[str, list[PR]] = OrderedDict()
    ungrouped: list[PR] = []
    active = [pr for pr in all_prs if pr.lifecycle != PRLifecycle.CLOSED]
    for pr in active:
        if pr.ticket:
            groups.setdefault(pr.ticket, []).append(pr)
        else:
            ungrouped.append(pr)

    def has_open(prs: list[PR]) -> bool:
        return any(p.lifecycle in (PRLifecycle.OPEN, PRLifecycle.DRAFT) for p in prs)

    open_g = [(t, p) for t, p in groups.items() if has_open(p)]
    done_g = [(t, p) for t, p in groups.items() if not has_open(p)]
    open_g.sort(key=lambda kv: max(p.created_at for p in kv[1]), reverse=True)
    done_g.sort(key=lambda kv: max(p.merged_at or p.created_at for p in kv[1]), reverse=True)
    sorted_groups = open_g + done_g
    ungrouped.sort(key=lambda p: p.merged_at or p.created_at, reverse=True)

    label_width = max(1, min(7, max(len(status_text(v)) for v in status_alias)))
    repo_width = max(4, min(max_repo_len, max((len(repo_text(v)) for v in repo_short.values()), default=4) + 1))

    def render_pr(pr: PR) -> list[str]:
        short = repo_text(repo_short.get(pr.repo, pr.repo.split("/", 1)[-1]))
        color = repo_color.get(pr.repo, "")
        title = strip_ticket(pr.title)
        ds = pr.display_state
        emoji, label, ansi = DISPLAY_META[ds]
        padded = status_text(label).ljust(label_width)
        repo_pad = short.ljust(repo_width)

        detail_parts: list[str] = []
        if pr.has_conflicts and not slack:
            detail_parts.append(f"{RED}🔀 conflicts{NC}")
        if pr.reviewers:
            reviewer_strs = [render_reviewer(r) for r in pr.reviewers]
            detail_parts.append("  ".join(strip_formatting(s) if slack else s for s in reviewer_strs))
        if pr.ci == CIState.FAIL:
            names = ", ".join(pr.ci_failed[:2])
            detail_parts.append(f"CI: {names}" if slack else f"{RED}CI:{NC} {names}")
        elif pr.ci == CIState.PENDING:
            detail_parts.append("CI pending" if slack else f"{YELLOW}CI pending{NC}")
        detail = "  ".join(detail_parts)

        if slack:
            line = f"{emoji} `{padded}| {repo_pad}|`  {title}  [#{pr.number}]({pr.url})"
            if detail:
                line += f"  {strip_formatting(detail)}"
            return [line]

        pr_link = osc8(pr.url, f"#{pr.number}")
        term_status = f"\033[{ansi}m{emoji} {padded}{NC}"
        meta = f"  {term_status}  {color}{repo_pad}{NC}  {pr_link}"
        detail_plain = strip_formatting(detail)

        if width < 72:
            indent = "      " if width >= 52 else "    "
            out = [meta, f"{indent}{DIM}{truncate_text(title, max(12, width - len(indent)))}{NC}"]
            if detail_plain:
                out.append(f"{indent}{truncate_text(detail_plain, max(10, width - len(indent)))}")
            return out

        base_prefix = f"  {term_status}  {color}{repo_pad}{NC}  "
        base_suffix = f"  {pr_link}"
        available = width - visible_len(base_prefix) - visible_len(base_suffix)
        if width < 96:
            out = [f"{base_prefix}{DIM}{truncate_text(title, max(16, available))}{NC}{base_suffix}"]
            if detail_plain:
                out.append(f"      {truncate_text(detail_plain, max(12, width - 6))}")
            return out

        title_budget = max(18, available)
        detail_budget = 0
        if detail_plain and available > 30:
            title_budget = max(18, int(available * 0.58))
            detail_budget = max(0, available - title_budget - 2)
        line = f"{base_prefix}{DIM}{truncate_text(title, title_budget)}{NC}{base_suffix}"
        if detail_plain and detail_budget > 0:
            line += f"  {truncate_text(detail_plain, detail_budget)}"
        return [line]

    def render_header(ticket: str, title: str) -> list[str]:
        if not slack:
            title = truncate_text(title, max(20, width - len(ticket) - 4))
        elif len(title) > 70:
            title = title[:67] + "..."
        return ["", f"*{ticket}: {title}*" if slack else f"{BOLD}{ticket}: {title}{NC}"]

    def render_collapsed(prs: list[PR]) -> str:
        refs = []
        for pr in prs:
            short = repo_text(repo_short.get(pr.repo, pr.repo.split("/", 1)[-1]))
            color = repo_color.get(pr.repo, "")
            refs.append(f"{short} [#{pr.number}]({pr.url})" if slack else f"{color}{short}{NC} {osc8(pr.url, f'#{pr.number}')}")
        ref_str = "  ".join(refs)
        if slack:
            return f"✅ All in prod: {ref_str}"
        summary = f"  {GREEN}✅  All in prod{NC}  {ref_str}"
        if visible_len(summary) > width:
            return f"  {GREEN}✅  All in prod{NC}  {truncate_text(strip_formatting(ref_str), max(10, width - 18))}"
        return summary

    def all_prod(prs: list[PR]) -> bool:
        return bool(prs) and all(p.deploy == DeployState.PROD for p in prs)

    for ticket, prs in sorted_groups:
        prs.sort(key=lambda p: (repo_order.get(p.repo, 99), 0 if p.lifecycle in (PRLifecycle.OPEN, PRLifecycle.DRAFT) else 1))
        top_repo = prs[0].repo
        top_prs = sorted([p for p in prs if p.repo == top_repo], key=lambda p: p.created_at or p.merged_at)
        lines.extend(render_header(ticket, strip_ticket(top_prs[0].title)))
        if all_prod(prs):
            lines.append(render_collapsed(prs))
        else:
            for pr in prs:
                lines.extend(render_pr(pr))

    if ungrouped:
        lines.append("")
        lines.append("*Other*" if slack else f"{BOLD}Other{NC}")
        if all_prod(ungrouped):
            lines.append(render_collapsed(ungrouped))
        else:
            for pr in ungrouped:
                lines.extend(render_pr(pr))

    if slack:
        lines = [f"> {line}" if line.strip() else line for line in lines]
    return lines
