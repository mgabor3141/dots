"""Shared utilities for running external commands."""

from __future__ import annotations

import json
import os
import subprocess
from typing import Optional


def run(
    cmd: list[str],
    env: Optional[dict] = None,
    timeout: int = 30,
    warn_on_failure: Optional[str] = None,
) -> Optional[str]:
    """Run a command, return stdout or None on failure."""
    try:
        merged_env = {**os.environ, **(env or {})}
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=merged_env,
        )
        if r.returncode == 0:
            return r.stdout.strip()
        if warn_on_failure:
            stderr = r.stderr.strip()
            if stderr:
                import sys
                print(f"\033[2m  ⚠ {warn_on_failure}: {stderr[:120]}\033[0m", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        if warn_on_failure:
            import sys
            print(f"\033[2m  ⚠ {warn_on_failure}: timed out after {timeout}s\033[0m", file=sys.stderr)
        return None
    except FileNotFoundError:
        return None


def gh_graphql(query: str, git_dir: Optional[str] = None) -> Optional[dict]:
    """Run a GraphQL query via gh api."""
    env = {"GIT_DIR": git_dir} if git_dir else {}
    result = run(["gh", "api", "graphql", "-f", f"query={query}"], env=env, timeout=30)
    if result:
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return None
    return None
