---
name: harness-review
description: Run a read-only Codex review of code, plans, scope, setup, or Harness integrity with findings-first output.
---

# harness-review

Use this skill when the user asks Codex to review a diff, PR, plan, scope, setup state, or Harness installation without starting implementation.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve repository root, branch, upstream, and dirty status.
   - Identify the exact diff, commit range, PR, or files under review.
2. Read-only review gate
   - Do not edit files, create commits, push branches, or resolve review threads.
   - If the user later asks for fixes, hand off to `harness-work` or `tdd-implement`.
3. Scope gate
   - Review only the user-specified surface unless the requested risk requires a narrow supporting file read.
   - Keep forbidden paths and immutable regions explicit.
4. Finding severity gate
   - Lead with actionable findings ordered by severity.
   - Use `Critical`, `Major`, `Minor`, or `Info` according to user instructions.
   - Omit speculative issues when evidence is weak.
5. No-patch gate
   - Do not include implementation patches in a review-only response.
   - Provide concise reproduction or proof for each material issue.
6. Codex second-opinion gate
   - Required before reporting review work as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark review work clear until the second opinion returns `PASS`.
7. Local-only boundary gate
   - Treat `.docs/handoff/` and live `harness.config.json` as local state unless explicitly included in review scope.

## Workflow

1. Pin the review target and compare it with the current branch state.
2. Read the minimum code and docs needed to substantiate findings.
3. Check correctness, safety, compatibility, test coverage, public/local boundary, and stale documentation.
4. Run the Codex second-opinion gate before reporting a clean review result.
5. Return findings with file/line references when possible.
6. Include open questions only after findings.

## Completion Contract

Report the reviewed target, findings, second-opinion status, residual risks or test gaps, files inspected, and local-only boundary status.
