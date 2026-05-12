---
name: tdd-implement
description: Implement one Codex task with RED, GREEN, refactor, verification, and local review before handoff or push.
---

# tdd-implement

Use this skill for a single implementation task that should be carried from test design through verification.

## Codex-Native Gates

1. Repository and branch gate
   - Confirm the worktree root, branch, and dirty status before editing.
   - Separate user changes from Codex changes and do not revert unrelated work.
2. Handoff and backlog gate
   - Read the task source supplied by the user, handoff files, or backlog files.
   - Pin the acceptance criteria before writing tests.
3. RED gate
   - Write a failing test first unless the change is documentation-only.
   - Run the targeted command and keep the failure output in mind while implementing.
4. GREEN gate
   - Make the smallest production or documentation change that satisfies the test.
   - Run the targeted test until it passes.
5. Refactor gate
   - Clean up duplication or awkward structure only inside the touched scope.
   - Preserve existing style and public contracts.
6. Local review gate
   - Inspect `git diff` for logic bugs, missing edge cases, accidental platform coupling, and stale docs.
   - Fix actionable local review findings and rerun affected checks.
7. Codex second-opinion gate
   - Required before reporting the implementation as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the implementation clear until the second opinion returns `PASS`.
8. CI and CodeRabbit gate
   - Run the repo's typecheck, build, smoke, or full test commands as appropriate.
   - Use `pseudo-coderabbit-loop` before push for non-trivial diffs.
9. Local-only boundary gate
   - Keep live handoff state and self-hosting config out of tracked files.
   - Keep Codex metadata out of the Claude Code adapter.

## Verification Ladder

Start narrow and broaden only as risk increases:

```bash
npm test -- <focused-test>
npm run typecheck
npm run build
npm test
```

Use the repository's actual package scripts when they differ from this generic example.

## Completion Contract

Report what failed in RED, what passed in GREEN, the second-opinion status, the final verification commands, and any follow-up that remains outside the current task.
