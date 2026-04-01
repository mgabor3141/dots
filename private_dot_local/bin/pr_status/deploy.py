"""Deploy status detection via GitHub API (no local git required)."""

from __future__ import annotations

import re
from typing import Optional

from .discover import Repo
from .model import DeployState, PR, PRLifecycle
from .util import gh_graphql, run


def detect_deploy_status(
    repo: Repo, prs: list[PR],
) -> tuple[dict[int, DeployState], list[str]]:
    """Determine deployment status for merged PRs. Uses only GitHub API."""
    merged = [p for p in prs if p.lifecycle == PRLifecycle.MERGED]
    if not merged:
        return {}, []

    owner, name = repo.owner_repo.split("/", 1)
    warnings: list[str] = []

    default_branch = _detect_default_branch(repo)
    if not default_branch:
        return {p.number: DeployState.UNKNOWN for p in merged}, ["could not detect default branch"]

    # Strategy 1: develop/release branch model (no API calls for status)
    has_branches = _check_branches_exist(repo, ["release", "develop"])
    if "release" in has_branches and "develop" in has_branches:
        return _deploy_via_branches(repo, merged)

    # Strategy 2: CI commit statuses
    return _deploy_via_ci(repo, merged, default_branch)


def _detect_default_branch(repo: Repo) -> Optional[str]:
    if repo.git_dir:
        result = run(
            ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
            env={"GIT_DIR": repo.git_dir},
        )
        if result:
            return result.replace("refs/remotes/origin/", "")
        for candidate in ("main", "master", "develop"):
            if run(["git", "rev-parse", f"origin/{candidate}"], env={"GIT_DIR": repo.git_dir}):
                return candidate

    result = run(["gh", "api", f"repos/{repo.owner_repo}", "--jq", ".default_branch"])
    return result if result else "main"


def _check_branches_exist(repo: Repo, branches: list[str]) -> set[str]:
    found: set[str] = set()
    if repo.git_dir:
        for b in branches:
            if run(["git", "rev-parse", f"origin/{b}"], env={"GIT_DIR": repo.git_dir}):
                found.add(b)
    else:
        for b in branches:
            if run(["gh", "api", f"repos/{repo.owner_repo}/branches/{b}", "--jq", ".name"]):
                found.add(b)
    return found


def _deploy_via_branches(
    repo: Repo, merged: list[PR],
) -> tuple[dict[int, DeployState], list[str]]:
    owner, name = repo.owner_repo.split("/", 1)

    query = '''query {
      repository(owner: "%s", name: "%s") {
        release: ref(qualifiedName: "refs/heads/release") {
          target { ... on Commit { committedDate } }
        }
        develop: ref(qualifiedName: "refs/heads/develop") {
          target { ... on Commit { committedDate } }
        }
      }
    }''' % (owner, name)

    data = gh_graphql(query, repo.git_dir)
    if not data:
        return {p.number: DeployState.UNKNOWN for p in merged}, ["GraphQL query failed"]

    repo_data = data.get("data", {}).get("repository", {})
    release_date = (repo_data.get("release") or {}).get("target", {}).get("committedDate", "")
    develop_date = (repo_data.get("develop") or {}).get("target", {}).get("committedDate", "")

    result: dict[int, DeployState] = {}
    warnings: list[str] = []
    for pr in merged:
        if release_date and pr.merged_at <= release_date:
            result[pr.number] = DeployState.PROD
        elif develop_date and pr.merged_at <= develop_date:
            result[pr.number] = DeployState.PREPROD
        else:
            result[pr.number] = DeployState.MERGED
    return result, warnings


def _deploy_via_ci(
    repo: Repo, merged: list[PR], default_branch: str,
) -> tuple[dict[int, DeployState], list[str]]:
    owner, name = repo.owner_repo.split("/", 1)

    query = '''query {
      repository(owner: "%s", name: "%s") {
        object(expression: "%s") {
          ... on Commit {
            history(first: 30) {
              nodes {
                oid
                committedDate
                status { contexts { context state } }
              }
            }
          }
        }
      }
    }''' % (owner, name, default_branch)

    data = gh_graphql(query, repo.git_dir)
    if not data:
        return {p.number: DeployState.UNKNOWN for p in merged}, ["GraphQL query failed"]

    nodes = (
        data.get("data", {})
        .get("repository", {})
        .get("object", {})
        .get("history", {})
        .get("nodes", [])
    )
    if not nodes:
        return {p.number: DeployState.UNKNOWN for p in merged}, ["no commits on default branch"]

    # Discover deploy context names
    all_contexts: set[str] = set()
    for node in nodes:
        for ctx in (node.get("status") or {}).get("contexts", []):
            all_contexts.add(ctx.get("context", ""))

    prod_ctx = None
    preprod_ctx = None
    for ctx in sorted(all_contexts):
        if re.search(r"promot|deploy", ctx, re.I):
            if re.search(r"prod", ctx, re.I) and not re.search(r"pre-?prod|staging", ctx, re.I):
                if not prod_ctx:
                    prod_ctx = ctx
            if re.search(r"pre-?prod|staging", ctx, re.I):
                if not preprod_ctx:
                    preprod_ctx = ctx

    if not prod_ctx and not preprod_ctx:
        return {p.number: DeployState.PROD for p in merged}, []

    # Find deploy marker timestamps
    prod_date = None
    preprod_date = None
    for node in nodes:
        by_ctx = {
            c["context"]: c["state"]
            for c in (node.get("status") or {}).get("contexts", [])
        }
        commit_date = node.get("committedDate", "")
        if prod_ctx and not prod_date and by_ctx.get(prod_ctx) == "SUCCESS":
            prod_date = commit_date
        if preprod_ctx and not preprod_date and by_ctx.get(preprod_ctx) == "SUCCESS":
            preprod_date = commit_date
        if (prod_date or not prod_ctx) and (preprod_date or not preprod_ctx):
            break

    warnings: list[str] = []
    if preprod_ctx and not preprod_date:
        warnings.append("could not find last preprod deploy in recent history")
    if prod_ctx and not prod_date:
        warnings.append("could not find last prod deploy in recent history")

    result: dict[int, DeployState] = {}
    for pr in merged:
        if prod_date and pr.merged_at <= prod_date:
            result[pr.number] = DeployState.PROD
        elif preprod_date and pr.merged_at <= preprod_date:
            result[pr.number] = DeployState.PREPROD
        elif not prod_date and not preprod_date:
            result[pr.number] = DeployState.UNKNOWN
        else:
            result[pr.number] = DeployState.MERGED
    return result, warnings
