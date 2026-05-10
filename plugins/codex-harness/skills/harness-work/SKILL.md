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
7. Local-only boundary gate
   - Never commit live `harness.config.json`.
   - Never commit `.docs/handoff/` session state.
   - Keep Codex adapter files under `plugins/codex-harness/` and repo marketplace files under `.agents/plugins/`.

## Workflow

1. Classify the request as a single task, a small batch, or a handoff resume.
2. Build a short checklist covering RED, GREEN, verification, local review, and handoff updates.
3. Route one implementation task to `tdd-implement`.
4. Use `pseudo-coderabbit-loop` before push when the branch is intended for PR.
5. Use `session-handoff` at the end when the user asked for durable next-session context.

## Completion Contract

End with the branch, files changed, tests run, remaining risks, and whether the local-only boundary stayed clean.
