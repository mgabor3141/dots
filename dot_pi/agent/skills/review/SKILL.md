---
name: review
description: Orchestrate adversarial code review via parallel subagents — one adversarial anchor reviewer plus several cheap angle-focused reviewers. Use when the user asks to review a commit/stack/PR adversarially, run a review round on implemented slices, or verify subagent-produced work before integration.
---

# Adversarial review orchestration

Spawn reviewers as fresh sessions per the `handoff` skill. Untracked docs don't travel between grove workspaces — copy ADRs/reports the reviewers need into the workspace's `.memory/`.

## Principles

- **Reviewers must reproduce, not argue.** Reviewers reasoning only from source approve real bugs; reviewers writing throwaway probes (schedule fakes, differential fuzzers, SQL probes) find them. Every handoff must license: "you may run tests and write throwaway probe tests, but delete them; `jj diff` must stay clean outside `.memory/`." Demand deterministic reproduction of concurrency claims.
- **No prior stake.** Reviewers get the design docs and the code — not the implementer's chat context or other reviews. Comments and doc-strings are claims, not evidence; say "do not accept comments as proof" in the handoff.
- **A clean verdict with no probes is unreliable, not reassuring.**
- **Withdrawn findings are re-litigable.** Reviewers have both wrongly withdrawn real bugs and wrongly approved real races.
- **Fixes introduce bugs.** A fix for one race silently dropped events on a different failure path; only the delta re-review caught it.
- **Cheap models fabricate evidence — including negative claims.** An angle reviewer confidently asserted the implementer had invented production symbols, citing a counter-mechanism that itself didn't exist; the implementer's evidence-backed rejection was correct. Treat "X does not exist" claims as findings needing verification, require reviewers to include the exact grep/file:line they ran, and verify rejections yourself **in the reviewed workspace's tree** — a grep in another checkout at a different revision proves nothing.
- **Implementer pushback is part of the loop.** Let the implementer reject findings with file:line evidence; adjudicate rejections rather than mechanically applying every finding.

## Topology: one anchor + N angles, in parallel

- **Anchor (1×, strongest model):** full adversarial "break it" review. Finds the defects that block integration.
- **Angles (N×, cheap/local model):** each gets exactly ONE focus. Proven foci: concurrency inventory (every goroutine/lock/channel, trace named schedules); SQL semantics (build the mutation table: every predicate vs every mutation path); design fidelity (claim-by-claim table of implementer's report vs ADR); test quality (per-test: which assertion catches the claimed defect; mutation-test it; hunt vacuous tests).
- Have every reviewer adjudicate the implementer's open questions — convergent independent answers settle judgment calls cheaply.
- **Mutation-testing reviewers need isolation.** A tests-angle reviewer's temporary local edits landed in another reviewer's build mid-review (who correctly flagged working-copy tampering). Give any reviewer licensed to edit tracked files (even revert-after) its own workspace, or serialize it after the read-only reviewers.
- **Cross-read the reports.** Angle reviewers assemble the evidence for a bug without drawing the conclusion (one built the exact mutation table implying a defect and still said integrate). Connect findings across reports; don't just tally verdicts.

## Round mechanics

- `gmux wait` breaks when the daemon restarts (dev rebuild loops); poll for report files instead.
- Deliverable per reviewer: findings by severity with `file:line` evidence, verdict integrate/amend/reject — per commit, not per round.
- Amend: each fix lands in the commit that introduced the defect (`jj new <commit>` → edit → `jj squash`); every stack commit stays individually green. A reviewer-suggested fix that fights the code means stop and report, not improvise.
- Delta re-review by the original finding's reviewer (existing session), demanding a dominance argument: "what did the removed/changed mechanism actually protect that the replacement does not?"
- Run the validation gate yourself before integrating; don't take the implementer's word.
