"""
pr-status — Show status of your recent PRs across multiple GitHub repos.

Discovers repos from subdirectories or from your recent GitHub PR activity.
Groups PRs by ticket ID, shows review state, CI status, and deployment
status (preprod/prod) when detectable from CI commit statuses or branch models.

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
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from .deploy import detect_deploy_status
from .discover import (
    Repo, assign_display_attrs,
    discover_repos_local, discover_repos_from_prs,
)
from .fetch import fetch_prs
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


def run_once(
    repos: list[Repo],
    author: str,
    since: str,
    check_deploy: bool,
    slack: bool,
) -> tuple[Snapshot, list[str]]:
    """Run one full cycle. Returns (snapshot, output_lines)."""
    t0 = time.monotonic()
    print(f"{DIM}Fetching PRs across {len(repos)} repos...{NC}", file=sys.stderr)

    all_prs: list[PR] = []
    with ThreadPoolExecutor(max_workers=len(repos)) as pool:
        futures = {pool.submit(fetch_prs, repo, author, since): repo for repo in repos}
        for f in as_completed(futures):
            all_prs.extend(f.result())

    t1 = time.monotonic()

    if not check_deploy:
        # Without deploy checks, treat merged PRs as "merged" (not "unknown")
        for pr in all_prs:
            if pr.lifecycle == PRLifecycle.MERGED:
                pr.deploy = DeployState.MERGED
    else:
        print(f"{DIM}Checking deployment status...{NC}", file=sys.stderr)
        repo_prs: dict[str, list[PR]] = {}
        for pr in all_prs:
            repo_prs.setdefault(pr.repo, []).append(pr)

        with ThreadPoolExecutor(max_workers=len(repos)) as pool:
            futures = {}
            for repo in repos:
                prs = repo_prs.get(repo.name, [])
                futures[pool.submit(detect_deploy_status, repo, prs)] = repo

            for f in as_completed(futures):
                repo = futures[f]
                deploy_info, warnings = f.result()
                for pr in repo_prs.get(repo.name, []):
                    if pr.number in deploy_info:
                        pr.deploy = deploy_info[pr.number]
                for w in warnings:
                    print(f"{YELLOW}  ⚠ {repo.name}: {w}{NC}", file=sys.stderr)

    t2 = time.monotonic()
    print(f"{DIM}Done (PRs: {t1 - t0:.0f}s, deploy: {t2 - t1:.0f}s){NC}", file=sys.stderr)

    lines = render(all_prs, repos, slack)
    return Snapshot(prs=all_prs), lines


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

    repos = discover_repos_local()
    if not repos:
        print(f"{DIM}No local repos found, discovering from GitHub PR history...{NC}", file=sys.stderr)
        repos = discover_repos_from_prs(args.author, since)

    if not repos:
        print("No repos found. Run from a directory with git repos, or ensure you have recent PRs on GitHub.", file=sys.stderr)
        sys.exit(1)

    assign_display_attrs(repos)

    if args.watch is None:
        snapshot, lines = run_once(repos, args.author, since, args.deploy, args.slack)
        for line in lines:
            print(line)
    else:
        prev: Optional[Snapshot] = None
        while True:
            try:
                current, lines = run_once(repos, args.author, since, args.deploy, args.slack)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"{RED}Error: {e}{NC}", file=sys.stderr)
                current, lines = None, []

            os.system("clear")
            for line in lines:
                print(line)

            if prev and current:
                diff_and_notify(prev.prs, current.prs)
            if current:
                prev = current

            try:
                time.sleep(args.watch)
            except KeyboardInterrupt:
                break


if __name__ == "__main__":
    main()
