"""Shared utilities for running external commands."""

from __future__ import annotations

import json
import os
import subprocess
from typing import Optional


def run(cmd: list[str], env: Optional[dict] = None, timeout: int = 30) -> Optional[str]:
    """Run a command, return stdout or None on failure."""
    try:
        merged_env = {**os.environ, **(env or {})}
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=merged_env,
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except (subprocess.TimeoutExpired, FileNotFoundError):
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
