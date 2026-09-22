---
name: adversarial-review
description: Perform an evidence-driven adversarial code review using mechanism tracing, focused probes, and reproducible findings. Use when personally reviewing a commit, stack, PR, patch, or implementation.
---

# Adversarial review

Try to falsify the implementation's important claims. Comments, test names, and implementation reports are claims—not evidence.

## Review

1. **Inventory important claims.** Include implicit properties such as no lost events, atomic persistence, safe cancellation, cleanup, retries, and compatibility. Prioritize data loss, corruption, security, deadlock, and silent failure.
2. **Trace claims to mechanisms.** Follow inputs, mutations, state transitions, ownership, and success/failure/retry/cancellation paths. Check callers that rely on the behavior. Do not accept comments as proof.
3. **Try to break them.** Prefer the smallest meaningful probe: a focused test, throwaway reproducer, deterministic fake or schedule, SQL experiment, failure injection, differential test, or mutation test. Merely rerunning the normal suite is weak evidence.
4. **Validate findings.** Reproduce against the reviewed revision, minimize the trigger, identify expected versus actual behavior, and check whether another mechanism prevents it. State any unverified step.
5. **Interrogate the tests.** Identify the assertion that would catch each claimed defect. Look for unexecuted branches, vacuous assertions, unrealistic fakes, and untested failure paths. Mutate important mechanisms or assertions when practical.

You may write throwaway probes. Before editing tracked files, check whether you are already in an isolated workspace. If the handoff is unclear, consider creating one or ask the requester; whoever creates it owns cleanup. Restore temporary changes before reporting. If meaningful execution is impractical, explain why and lower confidence in a clean verdict.

## Possible review angles

Choose angles based on the change and its likely failure modes; these are examples, not a checklist. Omit irrelevant angles and prioritize risks specific to the task.

- **Concurrency:** inventory tasks, locks, channels, cancellation, ownership transfers, and shutdown edges. Give a named schedule and deterministic reproduction; timing speculation is not enough.
- **Persistence:** compare selection predicates with mutation paths. Check transaction boundaries, affected-row handling, retries, uniqueness assumptions, and rollback.
- **Design fidelity:** map important design claims to their enforcing mechanisms and evidence.
- **Tests:** judge testing needs in context; missing tests are not inherently a defect. Misleading, brittle, or vacuous tests can be worse than none because they create false confidence. Be suspicious of assertions over incidental exact strings or configuration. Such tests freeze implementation details rather than behavior. For guarantees that do rely on tests, name the protecting assertion and verify it fails when the mechanism is broken.

## Report

List findings first, ordered by severity. Each finding needs:

- Severity and concise title
- Exact revision and `file:line` evidence
- Expected and actual behavior
- Reproduction or mechanism trace
- Impact, triggering conditions, and uncertainty

Distinguish reproduced defects from probable defects and unanswered risks; do not inflate questions into findings.

Conclude with an **integrate**, **amend**, **reject**, or **investigate further** verdict, plus commands run and areas not exercised. Keep investigating when you can resolve a material uncertainty yourself. Use **investigate further** when the needed work is blocked or impractical; state the uncertainty, blocker, and next useful step. For stacks, report per commit when useful and include a final-state verdict for cross-commit interactions.

## Review fixes

Re-run the original reproduction, then review the delta as new code. Ask what the changed mechanism previously protected and whether its replacement covers every adjacent success, failure, retry, and cancellation path. Do not approve merely because the original symptom disappeared.
