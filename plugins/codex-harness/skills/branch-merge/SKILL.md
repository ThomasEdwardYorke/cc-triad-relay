---
name: branch-merge
description: Merge a single feature branch through the integration branch while keeping release-branch exposure gated by PR, CI, CodeRabbit, and Codex review.
---

# branch-merge

Use this skill when the user asks Codex to merge one completed feature branch according to the repository branch strategy.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the repository, current branch, upstream, PR number, base branch, and head SHA.
   - Confirm the worktree is clean before merge operations.
2. Branch safety gate
   - Merge feature work into the integration branch first, defaulting to `dev`.
   - Stop on conflicts, stale head SHA, unexpected base branch, or dirty worktree.
   - Do not rewrite a remote branch unless the user explicitly approves `--force-with-lease`.
3. RED gate
   - Treat failing CI, failing local tests, unresolved CodeRabbit findings, or missing PR context as failing preconditions.
   - Capture the failing check or missing evidence before attempting a merge.
4. GREEN gate
   - Merge only after the PR is current, reviewed, and clean.
   - Re-run the relevant checks after any rebase or conflict resolution.
5. Local review gate
   - Review the final diff from integration branch to feature branch before merge.
   - Confirm scope is limited to the intended PR.
6. CI and CodeRabbit gate
   - Require green CI, latest CodeRabbit clear signal, and no current rate-limit or paused marker.
   - Do not resolve or reply to GitHub threads unless the user explicitly authorizes the action.
7. Codex CI and non-interactive automation gate
   - Confirm whether any Codex Action or `codex exec` check is `local-only`, `CI-optional`, or `release-blocking` for this repository.
   - GitHub CI remains the release-blocking source for build/test status unless maintainers explicitly require a Codex workflow.
   - CodeRabbit remains the PR review source when configured; do not duplicate CodeRabbit with broad style-only Codex automation.
8. Codex second-opinion gate
   - Required before reporting the merge as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the merge clear until the second opinion returns `PASS`.
9. Release-to-main gate
   - This skill may merge to the integration branch.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
10. Local-only boundary gate
   - Before merge and before final report, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Workflow

1. Confirm the PR is ready, mergeable, current, and targeted to the integration branch.
2. Confirm CI, CodeRabbit, and Codex second-opinion gates are clean.
3. Merge the feature branch into the integration branch using the repository's configured merge method.
4. Leave release branch promotion to `harness-release`.

## Completion Contract

Report the PR, merged branch, integration branch commit, tests, CodeRabbit status, second-opinion status, release-to-main gate status, and local-only boundary status.
