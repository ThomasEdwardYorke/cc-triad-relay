---
name: harness-merge-train
description: Merge multiple ready PRs into the integration branch in order with fail-fast review gates.
---

# harness-merge-train

Use this skill when the user asks Codex to merge multiple ready PRs or run a merge train.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve repository, ordered PR list, integration branch, release branch, and each PR head SHA.
   - Fetch before every PR in the train so stale state is visible.
2. Branch safety gate
   - Merge one PR at a time into the integration branch, defaulting to `dev`.
   - Fail fast on conflict, stale head SHA, unexpected base branch, failed check, or dirty worktree.
   - Do not continue to the next PR after a failed gate.
3. RED gate
   - Treat any pending or failing CI, unresolved CodeRabbit item, unreviewed head SHA, or unexpected diff overlap as the failing condition.
   - Record the exact PR and failing gate before stopping.
4. GREEN gate
   - Rebase or retarget only when the repository policy allows it and the user requested the merge train to keep moving.
   - Re-run the affected checks after any branch update.
5. Local review gate
   - Before each PR merge, inspect the final diff for scope creep and local-only leakage.
   - Keep outside-scope findings separate from merge blockers.
6. CI and CodeRabbit gate
   - Require each PR to have green CI, latest CodeRabbit clear signal, and no current rate-limit or paused marker.
   - Do not resolve or reply to GitHub threads unless the user explicitly authorizes the action.
7. Codex second-opinion gate
   - Required for each PR before marking that PR clear in the train.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the train clear until every PR second opinion returns `PASS`.
8. Release-to-main gate
   - Merge trains integrate feature PRs into the integration branch only.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
9. Local-only boundary gate
   - Before each PR merge and at the final report, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Workflow

1. Build the PR order and explain it before mutating branches.
2. For each PR, verify mergeability, CI, CodeRabbit, Codex second opinion, and local-only boundary.
3. Merge exactly one PR, fetch, and re-evaluate the next PR against the updated integration branch.
4. Stop immediately on the first failed gate.
5. Leave release branch promotion to `harness-release`.

## Completion Contract

Report each PR, merge order, merged commits, stopped PR if any, tests, CodeRabbit status, second-opinion status, release-to-main gate status, and local-only boundary status.
