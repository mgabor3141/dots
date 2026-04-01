"""Repo discovery: local filesystem and GitHub API fallback."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .util import run


@dataclass
class Repo:
    name: str
    owner_repo: str  # "owner/name"
    git_dir: Optional[str] = None  # local git dir, if available
    short_name: str = ""
    color: str = ""


MAX_REPO_NAME = 16


def shorten_repo_name(name: str) -> str:
    """Shorten long repo names by abbreviating leading segments to initials.
    e.g. example-backend-service -> e-b-service"""
    if len(name) <= MAX_REPO_NAME:
        return name
    sep = "-" if "-" in name else "_" if "_" in name else None
    if not sep:
        return name[: MAX_REPO_NAME - 1] + "…"
    parts = name.split(sep)
    if len(parts) < 2:
        return name[: MAX_REPO_NAME - 1] + "…"
    for i in range(len(parts) - 1):
        parts[i] = parts[i][0] if parts[i] else parts[i]
        if len(sep.join(parts)) <= MAX_REPO_NAME:
            return sep.join(parts)
    return sep.join(parts)


PALETTE = [
    "\033[0;36m",  # cyan
    "\033[0;32m",  # green
    "\033[0;35m",  # magenta
    "\033[0;34m",  # blue
    "\033[0;33m",  # yellow
    "\033[0;31m",  # red
]


def assign_display_attrs(repos: list[Repo]) -> None:
    for i, repo in enumerate(repos):
        repo.short_name = shorten_repo_name(repo.name)
        repo.color = PALETTE[i % len(PALETTE)]


# ============================================================
# Local discovery
# ============================================================


def discover_repos_local() -> list[Repo]:
    cwd = Path(".")
    if (cwd / ".git").exists() or (cwd / ".jj").exists():
        repo = _try_emit_repo(cwd)
        return [repo] if repo else []

    repos = []
    for d in sorted(cwd.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            repo = _try_emit_repo(d)
            if repo:
                repos.append(repo)
    return repos


def _try_emit_repo(d: Path) -> Optional[Repo]:
    git_dir = _find_git_dir(d)
    if not git_dir:
        return None

    remote_url = run(["git", "remote", "get-url", "origin"], env={"GIT_DIR": git_dir})
    if not remote_url or "github.com" not in remote_url:
        return None

    owner_repo = re.sub(r".*github\.com[:/]", "", remote_url)
    owner_repo = re.sub(r"\.git$", "", owner_repo)
    name = owner_repo.split("/")[-1]

    return Repo(name=name, git_dir=git_dir, owner_repo=owner_repo)


def _find_git_dir(d: Path) -> Optional[str]:
    git_path = d / ".git"
    jj_path = d / ".jj"

    if git_path.is_dir():
        return str(git_path)

    if git_path.is_file():
        result = run(["git", "-C", str(d), "rev-parse", "--git-dir"])
        return result if result else None

    if jj_path.is_dir():
        repo_pointer = jj_path / "repo"
        if repo_pointer.is_file() and not repo_pointer.is_dir():
            main_repo = repo_pointer.read_text().strip()
            git_target_file = Path(main_repo) / "store" / "git_target"
            if git_target_file.is_file():
                rel_target = git_target_file.read_text().strip()
                resolved = (git_target_file.parent / rel_target).resolve()
                if resolved.is_dir():
                    return str(resolved)
        elif (repo_pointer / "store").is_dir():
            jj_root = repo_pointer.parent.parent
            if (jj_root / ".git").is_dir():
                return str(jj_root / ".git")

    return None


# ============================================================
# Remote discovery (from PR activity)
# ============================================================


def discover_repos_from_prs(author: str, since: str) -> list[Repo]:
    result = run(
        ["gh", "search", "prs",
         "--author", author,
         "--created", f">={since[:10]}",
         "--limit", "100",
         "--json", "repository"],
        timeout=15,
    )
    if not result:
        return []

    try:
        items = json.loads(result)
    except json.JSONDecodeError:
        return []

    seen: dict[str, Repo] = {}
    for item in items:
        repo_info = item.get("repository", {})
        owner_repo = repo_info.get("nameWithOwner", "")
        name = repo_info.get("name", "")
        if owner_repo and owner_repo not in seen:
            seen[owner_repo] = Repo(name=name, owner_repo=owner_repo)
    return list(seen.values())
