---
name: pick-model
description: Choose models and thinking levels for subagents by role, with current-model resolution and fallbacks for unavailable providers. Use when selecting a model for delegation, review swarms, implementation, investigation, design work, or cheap spot checks.
---

# Pick a model

Prefer role aliases over hardcoded release names:

```bash
pick-model implement
pick-model review
pick-model focused-review
pick-model design
pick-model spot-check
```

The command resolves each family pattern to the newest matching model currently available to Pi, then prints a `provider/model:thinking` value suitable for a model argument:

```bash
gmux agent prompt --new --model "$(pick-model review)" 'Review this change'
```

Use `pick-model <alias> --all` to obtain ordered fallbacks, `--exclude-provider` when a provider is exhausted or unsuitable, and `--explain` when resolution is surprising. Availability filters missing models and unauthenticated providers; usage exhaustion may only become apparent when a request runs.
