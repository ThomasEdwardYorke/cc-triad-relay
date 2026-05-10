---
name: parallel-worktree
description: Coordinate multiple Codex worktrees with isolated write scopes, bounded concurrency, and merge ordering gates.
---

# parallel-worktree

Use this skill when the user asks Codex to split implementation across multiple independent worktrees or run a Codex-managed parallel task batch.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the repository, integration branch, current feature branch, upstream, and dirty status.
   - Start from a clean feature branch and stop if the base branch or upstream is ambiguous.
2. Worktree isolation gate
   - Create one writable worktree per independent task.
   - Do not share writable worktrees between tasks, reviewers, or delegated Codex runs.
   - Keep each task on a unique branch name derived from the parent feature branch and task slug.
3. Ownership boundary gate
   - Require every task to declare `owned_files` and `forbidden_files`.
   - Reject overlapping `owned_files` unless the user explicitly chooses serialized execution.
   - Stop if a task modifies a path outside `owned_files` or inside another task's `forbidden_files`.
4. Concurrency gate
   - Bound active Codex workers with `MAX_CODEX_PARALLEL`, defaulting to 1 when no project policy exists.
   - Increase concurrency only when task ownership is disjoint and the user accepts the cost.
   - Treat failed, blocked, or timed-out workers as a stop condition before launching more workers.
5. RED gate
   - Each worktree must add or identify the failing test or contract before implementation.
   - Record the failing command and task slug.
6. GREEN gate
   - Each worktree must pass its targeted checks before it can enter local review.
   - The coordinator must re-run affected checks after integrating a task branch.
7. Local review gate
   - Review each task diff against its `owned_files`, `forbidden_files`, and acceptance criteria.
   - Keep task-local findings separate from cross-task merge risks.
8. Merge ordering gate
   - Merge completed task branches into the parent feature branch in explicit order.
   - Re-check the parent feature branch after every merge.
   - Stop on conflict, stale task head, failed check, or unexpected diff expansion.
9. Codex second-opinion gate
   - Required before reporting any task or the batch as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the batch clear until every required second opinion returns `PASS`.
10. Release-to-main gate
   - Parallel work integrates into the feature branch and then the integration branch.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
11. Local-only boundary gate
   - Before final report, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Workflow

1. Decompose the work into task slugs with `owned_files`, `forbidden_files`, dependencies, and merge priority.
2. Validate ownership and dependency ordering before creating worktrees.
3. Launch up to `MAX_CODEX_PARALLEL` Codex workers.
4. Require each worker to run RED, GREEN, and local review inside its task worktree.
5. Request second opinion from a read-only path or a separate reviewer worktree before accepting the task.
6. Merge task branches into the parent feature branch one at a time.
7. Run the parent branch verification stack and local-only boundary guard.

## Completion Contract

Report the parent feature branch, task branches, worktree paths, `MAX_CODEX_PARALLEL`, merge order, tests, second-opinion status, CodeRabbit readiness, release-to-main gate status, and local-only boundary status.
