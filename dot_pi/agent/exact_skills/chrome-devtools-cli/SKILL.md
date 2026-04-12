---
name: chrome-devtools-cli
description: >
  Browser automation and inspection via the chrome-devtools CLI.
---

The `chrome-devtools` CLI lets you interact with a browser from the terminal.

## Workflow

1. **Execute**: Run tools directly (e.g., `chrome-devtools list_pages`). The background daemon starts implicitly on first use; do **not** call `start`/`status`/`stop` before each command.
2. **Inspect**: Use `take_snapshot` to get a text representation of the page with element `<uid>` values.
3. **Act**: Use `click`, `fill`, `hover`, `press_key`, etc., referencing UIDs from the snapshot. State persists across commands.

Snapshot output looks like:

```
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
  uid=1_2 link "More information..."
```

## Usage

```sh
chrome-devtools <tool> [positional-args] [--flags]
```

Every command supports `--help`. Output defaults to Markdown; use `--output-format=json` for structured output. Most interaction commands accept `--includeSnapshot true` to return a fresh snapshot with the result, saving a round-trip.

## Tips

- **Prefer snapshots over screenshots** for understanding page structure. Screenshots are useful for visual verification.
- **Chain commands in shell scripts** for multi-step flows; the daemon keeps browser state between invocations.
- **Use `evaluate_script`** for anything the built-in commands don't cover: `chrome-devtools evaluate_script "() => document.title"`.
- **Lighthouse audits** are available inline: `chrome-devtools lighthouse_audit --mode navigation`.
- **Network inspection**: `list_network_requests` and `get_network_request` let you inspect traffic without browser UI.
- **Performance traces**: `performance_start_trace` / `performance_stop_trace` capture timeline data for analysis.
