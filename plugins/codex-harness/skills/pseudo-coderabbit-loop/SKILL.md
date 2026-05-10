---
name: pseudo-coderabbit-loop
description: Run a local CodeRabbit-style pre-review from Codex before push, then fix actionable findings until clean.
---

# pseudo-coderabbit-loop

Use this skill before pushing a meaningful branch, especially when real CodeRabbit review capacity or PR round trips should be conserved.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the worktree, branch, base branch, and full diff.
   - Refuse to review an ambiguous branch or missing base without stating the uncertainty.
2. Handoff and backlog gate
   - Compare the diff against the task scope or handoff goal.
   - Flag outside-scope changes separately from code defects.
3. RED gate
   - For each actionable finding, identify the failing behavior or missing proof.
   - Add a focused test when the issue is behavioral and testable.
4. GREEN gate
   - Fix actionable findings and rerun the failing or missing check.
   - Keep nitpick-only suggestions bounded by the requested review profile.
5. Local review gate
   - Use CodeRabbit-style taxonomy:
     - review type: `potential_issue`, `refactor_suggestion`, or `nitpick`
     - severity: `critical`, `major`, `minor`, `trivial`, or `info`
     - scope: `in_diff` or `outside_diff`
   - Iterate until `actionable_count == 0`.
6. CI and CodeRabbit gate
   - Run the relevant local checks after fixes.
   - Push only after actionable local findings and tests are clean.
7. Local-only boundary gate
   - Review only tracked or intended-to-track public files.
   - Confirm local handoff and self-hosting files were not added accidentally.

## Profiles

- `chill`: report up to 3 actionable findings.
- `assertive`: report up to 6 actionable findings and include useful nitpicks.
- `strict`: local harness extension for release-hardening passes; keep it explicit when used.

## Completion Contract

Return a compact JSON-like summary with `actionable_count`, findings fixed, checks run, and any residual nitpicks intentionally deferred.
