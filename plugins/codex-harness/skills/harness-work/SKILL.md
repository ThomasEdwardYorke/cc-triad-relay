---
name: harness-work
description: Dispatch implementation work in Codex through the Harness quality gates, using handoff or backlog context when present.
---

# harness-work

Use this skill when the user asks Codex to implement, fix, refactor, or continue a Harness-managed task from local handoff or backlog context.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the real git worktree with `git rev-parse --show-toplevel`.
   - Report the current branch and status before editing.
   - Work on a feature branch cut from the integration branch for implementation work.
   - Do not touch `main` for feature development.
2. Handoff and backlog gate
   - Prefer `.docs/handoff/*-current.md` and `.docs/handoff/*-backlog.md` when the project uses handoff mode.
   - If handoff files are absent, fall back to the user's explicit task and existing repo docs.
   - Treat missing handoff files as absence of context, not as permission to invent project-local state.
3. RED gate
   - Add or update the narrowest failing test that expresses the requested behavior.
   - Run that test and confirm the failure is for the expected reason.
4. GREEN gate
   - Implement the smallest scoped change that passes the RED test.
   - Run the targeted test again and then broaden verification according to risk.
5. Local review gate
   - Review the diff for bugs, scope creep, platform leakage, and missing tests.
   - Fix actionable findings before considering the work complete.
6. CI and CodeRabbit gate
   - Before push, run `pseudo-coderabbit-loop` when the diff is meaningful.
   - After push, use `coderabbit-review` for actionable PR feedback.
7. Codex CI and non-interactive automation gate
   - Treat `codex exec` and Codex Action jobs as explicit automation evidence, not an implicit replacement for existing gates.
   - Classify each Codex automation path as `local-only`, `CI-optional`, or `release-blocking` before relying on it.
   - GitHub CI remains the release-blocking source for build/test/smoke status unless maintainers explicitly require a Codex workflow.
   - CodeRabbit remains the PR review source when configured; do not duplicate CodeRabbit with broad style-only Codex automation.
   - Prefer `codex exec --sandbox read-only --json --output-last-message <file>` for repeatable review or summary checks, and use `--sandbox workspace-write` only in isolated fix experiments followed by normal verification.
8. Codex second-opinion gate
   - Required before declaring implementation or review work clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the branch clear until the second opinion returns `PASS`.
9. Local-only boundary gate
   - Never commit live `harness.config.json`.
   - Never commit `.docs/handoff/` session state.
   - Keep Codex adapter files under `plugins/codex-harness/` and repo marketplace files under `.agents/plugins/`.

## Workflow

1. Classify the request as a single task, a small batch, or a handoff resume.
2. For handoff-managed work, start with `session-handoff check` and pin the top active task before editing.
3. Build a short checklist covering RED, GREEN, verification, local review, and handoff updates.
4. Route one implementation task to `tdd-implement`.
5. Use `pseudo-coderabbit-loop` before push when the branch is intended for PR.
6. Run the Codex second-opinion gate against the same diff before calling the branch clear.
7. After implementation status, PR status, CodeRabbit status, or CI status changes, run `session-handoff update`.
8. Before ending any implementation session that pushed a branch, opened a PR, or changed CodeRabbit/CI state, run `session-handoff archive` so the next Codex session has the exact restart point.

## Completion Contract

End with the branch, files changed, tests run, second-opinion status, PR/CodeRabbit/CI state, remaining risks, handoff update/archive status, and whether the local-only boundary stayed clean.
