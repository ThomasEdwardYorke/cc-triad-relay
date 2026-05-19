# Adapter Evaluation And Self-Improve Loop

This loop compares the Claude Code adapter and Codex adapter by operator
outcomes, not by identical file layout. Use it after adapter expansion work,
after review-loop regressions, and when session retrospectives show repeated
manual steering.

## Evaluation Checklist

Record one short evaluation for each meaningful adapter slice:

| Gate | Outcome to compare |
| --- | --- |
| planning | The adapter read handoff or backlog context, selected a narrow next scope, and surfaced unresolved assumptions before editing. |
| TDD | The branch captured RED evidence, implemented the smallest GREEN change, and reran focused tests before broader checks. |
| review | Local review, Codex second opinion, CodeRabbit CLI pre-push review, and PR CodeRabbit review each had a clear role and result. |
| branch | Work started from the integration branch, verified repository state, and kept unrelated dirty files out of the change. |
| merge | CI, CodeRabbit clear state, local-only boundary checks, and integration-branch update were confirmed before closing the branch. |
| handoff | `session-handoff archive`, `session-handoff update`, and the next restart prompt were current after the merge. |
| public/local boundary | Public docs stayed generic and did not include private paths, active branch notes, pull request state, commit identifiers, or live session state. |

## Outcome Metrics

Track metrics only when they change decisions:

- signal quality: actionable findings divided by total findings from local review,
  CodeRabbit CLI, PR CodeRabbit, Codex second opinion, and CI review artifacts
- false positives: findings skipped because current code or docs disproved them
- false negatives: defects found later that an earlier gate should have caught
- time-to-clear: elapsed review-loop time from first local pass to merge-ready
- defects caught: correctness, security, portability, docs drift, test gap, and
  public/local boundary issues found before merge
- docs drift: stale commands, config keys, official-doc references, or adapter
  parity claims that no longer match the shipped surface

## Self-Improve Intake Rules

Feed retrospectives into backlog candidates only when the root cause is generic
Harness behavior, not consumer project state. A candidate is acceptable when it
has:

- origin evidence from a session retrospective, review finding, CI failure, or
  handoff gap
- a root-cause statement that explains why the Harness workflow should change
- affected adapter scope for the Claude Code adapter, Codex adapter, or both
- acceptance criteria that can be tested or reviewed in a PR
- a validation plan covering docs, tests, public/local boundary, and review-loop
  behavior

Skip consumer-only incidents, one-off operator mistakes, private environment
state, and fixes that would publish project-specific assumptions into shared
adapter docs.

## Automation Gate Policy

Automation starts narrow and earns stronger gate status:

- `local-only`: ad hoc `codex exec` reviews, CodeRabbit CLI pre-push review,
  handoff summaries, and exploratory evaluation reports
- `CI-optional`: non-blocking scheduled audits, Codex Action review artifacts,
  or adapter comparison reports that are useful but still being tuned
- `release-blocking`: GitHub CI, configured PR CodeRabbit clear state,
  public/local boundary checks, and only automation that maintainers have
  explicitly promoted after enough clean signal

Promotion criteria require stable signal quality, low false positives, no known
false negatives for the covered gate, clear owner response, and repeatable
time-to-clear improvement. Demotion is required when a gate creates repeated
noise, misses relevant defects, blocks unrelated work, or depends on unstable
external context. Rollback means removing the required status first, then
keeping the check as `CI-optional` or `local-only` until the root cause is fixed.

## Backlog Candidate Shape

Use this shape when `harness-self-improve` proposes backlog candidates:

```md
- Source:
- Root cause:
- Generic Harness behavior:
- Adapter scope:
- Acceptance criteria:
- Validation:
- Gate status:
- Rollback or demotion trigger:
```

The proposal may reference sanitized session themes, but it must not publish
live branch names, pull request numbers, commit hashes, personal paths, secrets,
or active handoff state.
