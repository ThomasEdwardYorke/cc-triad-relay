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
7. CI and CodeRabbit gate
   - Run the repo's typecheck, build, smoke, or full test commands as appropriate.
   - Use `pseudo-coderabbit-loop` before push for non-trivial diffs.
8. Local-only boundary gate
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

Report what failed in RED, what passed in GREEN, the final verification commands, and any follow-up that remains outside the current task.
