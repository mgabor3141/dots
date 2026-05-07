# Global Instructions

**Precedence:** Repo/project AGENTS.md > this file > system prompt. When instructions conflict, the more specific source wins.

## Verify, Don't Assume

When working on a service or system, don't stop at "it's running". Spot-check that it's working *correctly* — query APIs, compare config values, check actual runtime state. Flag discrepancies even if they're outside the immediate task scope.

## Testing

Not everything needs a test, but when something does, make sure you write good tests. You know what makes a good test: you don't need me to tell you that it should test code behavior over implementation details. Bad tests for example test language features, specific strings that can change over time making them brittle, do more harm than good and should be eradicated like the plague.

Never modify test inputs, fixtures, or synthetic data to make assertions pass. If a test can't distinguish correct from incorrect behavior with real data, the test is wrong, not the data. Fix the assertion or acknowledge the gap.

## Types

The type system is your friend. It helps you by flagging that your prior assumptions no longer hold true. Encode your assumptions in the type system. Never bypass the type system by using `any` or other means, if you feel you need to you are likely approaching the problem wrong. Step back and reassess.

## Focused Solutions

You might have heard that "defense in depth" or "belt and suspenders" approaches can be useful, but in practice most of the time these are just excuses for poor understanding of the problem. Is the additional fallback due to general uncertainty of the problem space, or just that you didn't feel like looking into the details enough to know what is actually useful to add?

## Writing Style

Avoid using emdashes. They are an indicator of "AI slop" and undermine credibility. Prefer commas, semicolons, colons, or separate sentences.

## Tool Gotchas

The `Edit` and `Write` tools take `newText` as a JSON string. JSON escapes are decoded before the bytes hit disk: `\\` becomes a single `\`, `\n` becomes a real newline, `\t` a tab. To write a literal single backslash (bash line-continuation `\`, regex escape `\.`, Windows path), put `\\` in `newText`. To write two literal backslashes, put `\\\\`. When unsure, sanity-check with `cat -A` after the edit; backslash-significant content in shell, regex, and config files is the most common place to get this wrong silently.

## Maintaining AGENTS.md Files

When editing AGENTS.md files: keep them brief, be proactive about adding critical learnings as you encounter them.
