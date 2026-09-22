---
name: review-swarm
description: Coordinate independent reviewers, combine their evidence, adjudicate disagreements, and re-review fixes. Use when a change benefits from several review perspectives or parallel investigation.
---

# Review swarm

## Useful topologies

- **Anchor and angles:** one broad review plus narrower reviewers covering distinct risks.
- **Independent full reviews:** useful for small, judgment-heavy changes or when narrow framing may hide interactions.
- **Targeted investigation:** assign a specific uncertainty, subsystem, or disputed claim.
- **Delta review:** return a fix to the reviewer who found the original problem.

Give angle reviewers one clear focus. Possible angles include concurrency, persistence, security, failure paths, API compatibility, design fidelity, migrations, performance, and test quality. Pick risks suggested by the change, not a standard set.

Use stronger reviewers for broad synthesis and subtle system-wide reasoning. Bounded evidence-gathering tasks are better candidates for cheaper reviewers.

## Independence and context

For the first pass, provide neutral context: the code, intended behavior, design material, scope, and open questions. Withhold the implementer's defense of the implementation and other reviewers' conclusions until independent reports are in.

Have reviewers identify the revision they actually examined. Independent agreement on an open question is useful evidence, but not proof.

## Workspaces

Tell each reviewer which workspace it has and whether tracked edits are allowed. Prefer isolation for probes, mutation testing, revision changes, or commands that may rewrite files. Concurrent temporary edits must not leak into another reviewer's build.

Normally, whoever creates a workspace also cleans it up. State ownership when it may be ambiguous.

## Handoffs

Include what the reviewer cannot reliably infer:

- Target and workspace
- Scope or angle
- Relevant specifications and constraints
- Permission to probe or edit
- Non-obvious build and test commands
- Open questions
- Any required report format

Refer to an available review skill when useful, or include the relevant instructions directly. Ask reviewers not to spawn more agents unless nested orchestration is intentional.

## Combining reports

Cross-read reports for:

- Partial evidence that becomes meaningful only across reports
- Contradictions needing a targeted follow-up
- Conclusions unsupported by the evidence gathered
- Negative claims such as “X does not exist” without an exact search
- Evidence collected from the wrong revision or workspace
- Important claims no reviewer exercised

Verify disputed or material claims in the reviewed tree. Let the implementer respond with concrete evidence, then check the pushback rather than forwarding findings mechanically.

Continue in the same reviewer session when a follow-up depends on its prior reasoning. Keep first-pass reports independent; reveal another reviewer's conclusions only when needed for adjudication.

## Fixes

When practical, return a fix to the original finder. Have them re-run the reproduction, review the delta as new code, identify what the changed mechanism previously protected, and check adjacent success, failure, retry, and cancellation paths.

Record unresolved investigation with its blocker and next useful step.
