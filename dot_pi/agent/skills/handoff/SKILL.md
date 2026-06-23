---
name: handoff
description: Hand off a slice of work to a fresh agent session via gmux, optionally in a clean grove workspace. Use when the user asks to delegate a task or kick off an investigation, or when the current session is getting derailed and the right move is to spawn a focused subagent with its own context.
---

# Handoff

Spin off part of the current work into a fresh agent session. Use this when context should transfer to a new agent without dragging the whole current conversation along.

This is not `/compact`. Compaction shrinks the current session in place. Handoff splits off a slice and gives it its own context.

## Two flavors

Pick one based on what you actually know:

- **Defined task**: you know what needs to happen. The new session implements or executes a specific thing.
- **Investigation**: the user found something that may or may not be a real issue, or you noticed something tangential worth probing. The new session looks into it and reports back. "Nothing found" is a valid outcome.

Different docs come out of these. Don't force one structure on both; address what's relevant to the flavor.

## Workflow

### 1. Decide whether to grove

If the next session needs a clean filesystem (parallel branch work, isolated experiments, dependency changes you don't want bleeding into your current work), invoke the `grove` skill first to create the workspace. Skip it for read-only investigations or work that should land on the current branch.

```bash
grove new --no-editor -y <name>
cd .grove/<name>
```

If you use grove, **everything after this happens inside the grove workspace.**

### 2. Write the handoff doc

Write a single markdown file somewhere untracked by git. Follow the repo's convention if one exists: a `.memory/` folder, a `*.local.md` file, etc. `/tmp/` is fine when no convention applies and the work is short-lived.

What the doc should address depends on the flavor:

**Defined task:**

- What's been decided so far that the new session needs to inherit
- The specific thing the new session is supposed to do
- What success looks like
- What's explicitly out of scope, so the new session doesn't wander

**Investigation:**

- What was observed: the symptom, the suspicious thing, the user's report
- What you suspect, if anything, and why
- Where to look first
- What to report back, and the fact that "nothing found" is a valid report

Reference relevant files, paths, issues, and prior conversations by path or URL. Don't restate what's already written somewhere else.

### 3. Spawn it via gmux

Use the `gmux` skill to launch a new pi session in the background, pointing it at the doc:

```bash
gmux -d -- pi "Read $PWD/.memory/handoff-fix-auth.md and proceed."
```

Use an absolute path so the spawned pi can find the doc regardless of where it ends up running from.

Tell the user the gmux session id and the doc path so they can attach later.
