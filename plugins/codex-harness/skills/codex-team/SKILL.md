---
name: codex-team
description: Delegate review or implementation to additional Codex workers with fail-closed second-opinion and ownership controls.
---

# codex-team

Use this skill when the user asks for multiple Codex perspectives, delegated Codex implementation, or an adversarial Codex review within the Harness workflow.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the repository, branch, upstream, dirty status, and intended task mode before delegation.
   - Stop if the diff or target branch is ambiguous.
2. Worktree isolation gate
   - Use a read-only review path for second opinions whenever possible.
   - Use a dedicated writable worktree when a delegated Codex worker may edit files.
   - Do not share writable worktrees between tasks, reviewers, or delegated Codex runs.
3. Ownership boundary gate
   - For delegated implementation, require `owned_files` and `forbidden_files`.
   - Reject work that cannot be bounded to the declared ownership surface.
   - Review the returned diff against the ownership contract before integrating it.
4. Concurrency gate
   - Bound active Codex workers with `MAX_CODEX_PARALLEL`, defaulting to 1 when no project policy exists.
   - Run second-opinion reviews independently from the primary implementer.
   - Treat any worker returning `BLOCKED` as a batch stop until the blocker is resolved.
5. RED gate
   - Delegated implementation must identify or add a failing test before code changes are accepted.
   - Delegated review must state the exact diff or commit range it reviewed.
6. GREEN gate
   - Delegated implementation must return the checks it ran and their results.
   - The coordinator must rerun affected checks before accepting worker output.
7. Local review gate
   - Classify Codex findings as actionable or non-actionable before changing files.
   - Do not apply worker output blindly; inspect the diff and preserve user changes.
8. Merge ordering gate
   - Integrate delegated work one worker at a time in a deterministic order.
   - Re-check the parent branch after every accepted worker diff.
   - Stop on conflict, stale worker head, failed check, or unexpected diff expansion.
9. Codex second-opinion gate
   - Required before reporting delegated implementation, review, or the batch as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark delegated work clear until the second opinion returns `PASS`.
10. Release-to-main gate
   - Codex team work may prepare a feature branch or PR only.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
11. Local-only boundary gate
   - Before final report, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Modes

- `review`: independent Codex review of the current diff or PR.
- `implementation`: bounded delegated implementation in an isolated worktree.
- `adversarial`: security, data-loss, and failure-mode review with actionable findings only.

## Workflow

1. Choose a mode and declare the reviewed diff, PR, or task ownership contract.
2. Select the first available capability: Codex sub-agent, authenticated `codex` CLI, or fail-closed `BLOCKED`.
3. Enforce `MAX_CODEX_PARALLEL` while workers are active.
4. Inspect and classify worker output.
5. Integrate only accepted diffs, rerun checks, and request second opinion before reporting clear.

## Completion Contract

Report mode, reviewed diff or task ownership, active worker count, `MAX_CODEX_PARALLEL`, accepted findings, rejected findings, tests, second-opinion status, release-to-main gate status, and local-only boundary status.
