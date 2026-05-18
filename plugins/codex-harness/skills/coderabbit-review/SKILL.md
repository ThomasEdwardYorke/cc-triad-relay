---
name: coderabbit-review
description: Inspect and address actionable CodeRabbit or GitHub PR review feedback from Codex with scoped fixes and verification.
---

# coderabbit-review

Use this skill after a branch has a PR and the user wants Codex to inspect review feedback, identify actionable items, or apply fixes.

## Codex-Native Gates

1. Repository and branch gate
   - Confirm the local branch, remote, and associated PR before making changes.
   - Fetch or inspect PR state with the available GitHub tooling.
2. Handoff and backlog gate
   - Keep the PR goal aligned with the task or handoff context that produced the branch.
   - Do not expand the PR to unrelated backlog items.
3. RED gate
   - For each actionable review item, reproduce the issue with a focused test or concrete local check when possible.
   - If reproduction is impossible, state the evidence that makes the review item actionable.
4. GREEN gate
   - Apply the narrowest fix that addresses the actionable review item.
   - Avoid rewriting clean code only to satisfy style preferences.
5. Local review gate
   - Classify feedback as critical, major, minor, nitpick, or not actionable.
   - Fix critical and major issues first, then rerun targeted verification.
6. CI and CodeRabbit gate
   - Confirm PR number, head SHA, base branch, CI status, latest CodeRabbit review state, rate-limit or paused markers, and unresolved CodeRabbit review threads.
   - Check PR CI after fixes and verify that the reviewed head still matches the local branch head.
   - For draft PRs, trigger `@coderabbitai review` only when an explicit review is needed and no fresh review exists for the head SHA.
   - Do not resolve or reply to GitHub review threads unless the user explicitly authorizes that externally visible action.
7. External review metadata gate
   - Gather GitHub review metadata from the available connector, `gh`, or an explicitly configured optional external context.
   - Treat unavailable MCP as a warning when `gh` or connector data is sufficient, and do not block on optional external context unless PR review thread state cannot be established any other way.
   - Do not require private MCP state in the plugin; repository-shipped guidance must stay generic.
8. Codex second-opinion gate
   - Required after fixing CodeRabbit or GitHub review findings and before push, re-review request, or clear status.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the PR clear until the second opinion returns `PASS`.
9. Local-only boundary gate
   - Do not paste local handoff content into public PR comments.
   - Keep self-hosting files untracked.

## Feedback Rules

- Treat resolved or obsolete comments as closed unless the latest diff reintroduces the problem.
- Do not report false positives as findings.
- Keep review responses factual and tied to code, tests, or docs.
- Treat CodeRabbit clear as a three-part check: latest approval-like state when present, unresolved CodeRabbit threads equal zero, and no current rate-limit or paused marker.
- If a CodeRabbit finding is fixed locally, run the second-opinion gate before pushing the fix or asking CodeRabbit to review again.

## Completion Contract

Report the PR, head SHA, CI and CodeRabbit status, feedback inspected, fixes applied, tests run, second-opinion status, remaining unresolved actionable items, and whether the branch is ready for final CI or merge.
