"""
pr-status — Show status of your recent PRs across GitHub.

Discovers PRs globally using GitHub search, then enriches only the matching PRs
with per-repo detail. Groups PRs by ticket ID, shows review state, CI status,
and deployment status (preprod/prod) when detectable from branch models or CI
commit statuses.

Usage:
    pr-status [options]

Options:
    --days N         Look back N days (default: 30)
    --author USER    GitHub username (default: @me)
    --no-deploy      Skip deployment checks (faster)
    --slack          Output Slack-formatted markdown
    --watch [SECS]   Re-run every SECS seconds (default: 60), notify on changes
    --help           Show this help

Dependencies: python3 (3.8+), gh (GitHub CLI)
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from .deploy import detect_deploy_status
from .discover import Repo, build_repo_index, discover_pr_stubs
from .fetch import enrich_pr
from .model import DeployState, PR, PRLifecycle
from .notify import diff_and_notify
from .render import render

DIM = "\033[2m"
NC = "\033[0m"
RED = "\033[0;31m"
YELLOW = "\033[0;33m"


@dataclass
class Snapshot:
    prs: list[PR]


def render_snapshot(snapshot: Snapshot, slack: bool) -> list[str]:
    repos = build_repo_index([pr.repo for pr in snapshot.prs])
    return render(snapshot.prs, repos, slack)


def run_once(
    author: str,
    since: str,
    check_deploy: bool,
    slack: bool,
    enrich_cache: dict[tuple[str, int], tuple[str, PR]],
) -> tuple[Snapshot, list[str]]:
    """Run one full cycle. Returns (snapshot, output_lines)."""
    t0 = time.monotonic()
    print(f"{DIM}Searching GitHub for relevant PRs...{NC}", file=sys.stderr)
    pr_stubs = discover_pr_stubs(author, since)

    all_prs: list[PR] = []
    pending: list[dict] = []
    for pr_stub in pr_stubs:
        key = (pr_stub["_repo"], pr_stub["number"])
        cached = enrich_cache.get(key)
        if cached and cached[0] == pr_stub.get("updatedAt", ""):
            pr = cached[1]
            pr.sources = list(pr_stub.get("_sources") or [])
            all_prs.append(pr)
        else:
            pending.append(pr_stub)

    if pending:
        print(f"{DIM}Fetching PR details for {len(pending)} PRs...{NC}", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=min(8, len(pending))) as pool:
            futures = {pool.submit(enrich_pr, pr_stub): pr_stub for pr_stub in pending}
            for f in as_completed(futures):
                pr_stub = futures[f]
                pr = f.result()
                if not pr:
                    continue
                all_prs.append(pr)
                enrich_cache[(pr.repo, pr.number)] = (pr_stub.get("updatedAt", ""), pr)

    t1 = time.monotonic()
    repos = build_repo_index([pr.repo for pr in all_prs])

    if not check_deploy:
        for pr in all_prs:
            if pr.lifecycle == PRLifecycle.MERGED:
                pr.deploy = DeployState.MERGED
    elif repos:
        print(f"{DIM}Checking deployment status...{NC}", file=sys.stderr)
        repo_prs: dict[str, list[PR]] = {}
        for pr in all_prs:
            if "authored_merged" in set(pr.sources):
                repo_prs.setdefault(pr.repo, []).append(pr)

        deploy_repos = [repo for repo in repos if repo_prs.get(repo.owner_repo)]
        if deploy_repos:
            with ThreadPoolExecutor(max_workers=min(8, len(deploy_repos))) as pool:
                futures = {
                    pool.submit(detect_deploy_status, repo, repo_prs[repo.owner_repo]): repo
                    for repo in deploy_repos
                }
                for f in as_completed(futures):
                    repo = futures[f]
                    deploy_info, warnings = f.result()
                    for pr in repo_prs.get(repo.owner_repo, []):
                        if pr.number in deploy_info:
                            pr.deploy = deploy_info[pr.number]
                    for w in warnings:
                        print(f"{YELLOW}  ⚠ {repo.owner_repo}: {w}{NC}", file=sys.stderr)

    t2 = time.monotonic()
    print(f"{DIM}Done (discover: {t1 - t0:.0f}s, deploy: {t2 - t1:.0f}s){NC}", file=sys.stderr)

    snapshot = Snapshot(prs=all_prs)
    return snapshot, render_snapshot(snapshot, slack)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="pr-status", description=__doc__, add_help=False,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--author", default="@me")
    parser.add_argument("--no-deploy", dest="deploy", action="store_false", default=True)
    parser.add_argument("--slack", action="store_true")
    parser.add_argument("--watch", nargs="?", const=60, type=int, metavar="SECS")
    parser.add_argument("--help", "-h", action="store_true")

    args = parser.parse_args()

    if args.help:
        print(__doc__.strip())
        return

    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    enrich_cache: dict[tuple[str, int], tuple[str, PR]] = {}

    def draw(lines: list[str]) -> None:
        if args.watch is not None:
            os.system("clear")
        for line in lines:
            print(line)

    resized = False

    def on_resize(signum, frame) -> None:
        nonlocal resized
        resized = True

    if hasattr(signal, "SIGWINCH"):
        signal.signal(signal.SIGWINCH, on_resize)

    if args.watch is None:
        snapshot, lines = run_once(args.author, since, args.deploy, args.slack, enrich_cache)
        if not snapshot.prs:
            print("No PRs found.", file=sys.stderr)
            sys.exit(1)
        draw(lines)
    else:
        prev: Optional[Snapshot] = None
        current_snapshot: Optional[Snapshot] = None
        current_lines: list[str] = []
        while True:
            try:
                current_snapshot, current_lines = run_once(
                    args.author, since, args.deploy, args.slack, enrich_cache,
                )
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"{RED}Error: {e}{NC}", file=sys.stderr)
                current_snapshot, current_lines = None, []

            draw(current_lines)
            resized = False

            if prev and current_snapshot:
                diff_and_notify(prev.prs, current_snapshot.prs)
            if current_snapshot:
                prev = current_snapshot

            try:
                deadline = time.monotonic() + args.watch
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    if resized and current_snapshot:
                        current_lines = render_snapshot(current_snapshot, args.slack)
                        draw(current_lines)
                        resized = False
                    time.sleep(min(0.2, remaining))
            except KeyboardInterrupt:
                break


if __name__ == "__main__":
    main()
