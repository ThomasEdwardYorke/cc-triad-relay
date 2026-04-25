# `/harness-work` Essence — Cross-cutting Workflow Contract

The `/harness-work` skill is more than a dispatcher: it is a **workflow contract**
that any consumer can opt into via the `qualityGates.enforceHarnessWorkEssence`
flag. This document captures that contract as 13 observable invariants so the
Stop hook reminder, the skill spec, and the consumer rules all agree on the
same source of truth.

The flag ships **off by default**. Projects that already standardised on
`/harness-work` enable it to receive a bird's-eye reminder alongside the
phase-specific quality gates emitted by `hooks/stop.ts`.

> **Note on enforcement boundaries.** Most invariants are enforced by the
> orchestrator skills (`/harness-work` Auto Mode Detection, `/parallel-worktree`
> coordinator, `/tdd-implement` phase chain, `/coderabbit-review` Clear
> 3-tier judgment, `/codex-team` adversarial second opinion). A few are
> behavioural (#11 "never give up") and live in the Stop hook reminder so
> the LLM sees them at every turn boundary. None of these invariants is
> coupled to a specific project — they describe *how* harness-driven work
> proceeds, not *what* a particular codebase contains.

---

## The 13 invariants

| # | Invariant | Primary enforcement |
|---|---|---|
| 1 | Choose a broad scope, prioritise development speed, revisit task decomposition before starting | `/harness-work` Auto Mode Detection (Solo / Parallel / Breezing) routes by task count |
| 2 | Try the harness's newest features and feed observations back into harness improvements | `/parallel-worktree` adoption + skill-improvement PRs in the consumer backlog |
| 3 | Read the handoff documents first, identify the highest-priority task, and stand up a structured team | `/harness-work` Step 0 chains `/session-handoff check` automatically |
| 4 | Issues uncovered along the way must be addressed within the session, never deferred silently | LLM discipline + handoff backlog chain in Step 5 |
| 5 | Verify behaviour against Anthropic and harness official docs to keep both global and local rules satisfied | `/ask-codex` invocation + `claude-code-guide` agent |
| 6 | Manage work as a checklist so nothing slips | `/harness-work` Step 0 mandates `TaskCreate` |
| 7 | Implement using the TDD loop (Red → Green → Refactor) | `/tdd-implement` v2 (delegated by `/harness-work`) makes phases mandatory |
| 8 | Use Codex as both worker and reviewer in a parallel team | `/tdd-implement` Phases 4 (parallel implementation), 5 (review loop), 7 (adversarial) |
| 9 | Never break existing systems | Full test suite + content-integrity assertions + grep-based generality check |
| 10 | Resolve ambiguity by asking Codex to read the official documentation | `/ask-codex` discipline; never guess library behaviour |
| 11 | Never give up, never compromise quality | LLM discipline (no skill can enforce this) — surfaced as a Stop hook reminder so it is restated at every turn boundary |
| 12 | Resolve every CodeRabbit / Codex review finding, including nitpicks, before merging | `/tdd-implement` Phase 5 loops until `actionable_count == 0` |
| 13 | At session end, write the work report (checklist, plan vs. actual, files changed, caveats) and update the handoff (archive + update) | `/harness-work` closing step chains `/session-handoff archive` and `/session-handoff update`; Stop hook surfaces the same as a final reminder |

The Stop hook reminder is intentionally short — it is a pointer back to this
document, not a replacement for it. The skill specs (`commands/harness-work.md`,
`commands/tdd-implement.md`, `commands/parallel-worktree.md`) are the long-form
home of each invariant; the table above only enumerates them so reviewers can
audit coverage at a glance.

---

## Why a separate gate?

The four phase-specific gates (`enforceTddImplement`,
`enforcePseudoCoderabbit`, `enforceRealCoderabbit`,
`enforceCodexSecondOpinion`) are **per-review-phase**. They tell the LLM
"phase X is mandatory here". The `enforceHarnessWorkEssence` gate is
**cross-cutting**: scope-setting, the Codex team pattern, never-giving-up,
and the end-of-session handoff update apply *everywhere*, not at any one
phase.

Keeping them orthogonal means a mature project can keep the per-phase
reminders running while disabling the bird's-eye summary, or vice versa.
Default-off lets new adopters add the flag deliberately as a
"is the team using `/harness-work` correctly?" check.

---

## How the contract is verified

Three feedback loops keep this document, the Stop hook, and the consumer
skills in sync:

1. **Build-time** — `core/src/__tests__/generality.test.ts` ensures the
   doc itself stays generic (no project-specific paths or tracker IDs).
2. **Runtime** — `hooks/stop.ts` reads `gates.enforceHarnessWorkEssence`
   and emits the `[harness-work essence]` reminder block when on,
   pointing back to this document.
3. **Skill-time** — `commands/harness-work.md` Step 0 references the
   `/session-handoff check` gate (invariant 3) and the closing step
   references `/session-handoff archive` + `update` (invariant 13).

If any of those three drifts out of alignment, the others surface the
discrepancy at the next session.

---

## Adoption checklist for a consumer project

Projects opting in should:

1. Set `work.qualityGates.enforceHarnessWorkEssence = true` in
   `harness.config.json`.
2. Confirm `/harness-work` is the standard entry point (no manual
   Phase 2-5 loops).
3. Wire `/session-handoff check` into the session-start ritual and
   `update` + `archive` into the session-end ritual.
4. Document any project-specific deviation from the 13 invariants in
   the project's own `CLAUDE.md` so future sessions can see the
   rationale without re-reading this file.

The flag does not replace any of the existing gates — it complements
them.
