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
   - Check PR CI after fixes.
   - Confirm unresolved actionable CodeRabbit threads are cleared or responded to with evidence.
7. Local-only boundary gate
   - Do not paste local handoff content into public PR comments.
   - Keep self-hosting files untracked.

## Feedback Rules

- Treat resolved or obsolete comments as closed unless the latest diff reintroduces the problem.
- Do not report false positives as findings.
- Keep review responses factual and tied to code, tests, or docs.

## Completion Contract

Report the PR, feedback inspected, fixes applied, tests run, remaining unresolved actionable items, and whether the branch is ready for final CI or merge.
