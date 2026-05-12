---
name: session-handoff
description: Check, archive, or update Harness handoff context from Codex while keeping live session state local-only.
---

# session-handoff

Use this skill when the user asks to check current handoff context, prepare the next-session prompt, archive completed work, or update local handoff files.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the git worktree and branch before reading or editing handoff files.
   - Note whether the branch is ahead, behind, dirty, or clean.
2. Handoff and backlog gate
   - Read the current, backlog, roadmap, and decisions files if configured.
   - If the paths are not configured, search only the conventional `.docs/handoff/` local tree.
   - Mark missing files explicitly instead of guessing their contents.
   - For implementation sessions, follow the lifecycle cadence:
     `check -> update -> archive`.
3. RED gate
   - For implementation handoff changes, add a focused regression test first.
   - For handoff-only updates, the RED equivalent is an explicit stale or missing context finding.
4. GREEN gate
   - Update only the handoff artifacts needed by the user's requested operation.
   - Keep completed, next, decisions, and blockers distinct.
   - A session-end update must record the next-session quick-start, current branch, current commit, PR/CodeRabbit/CI state, and remaining tasks.
5. Local review gate
   - Re-read the updated handoff text for stale branch names, missing first command, and hidden assumptions.
   - Verify the next-session prompt is directly executable by a fresh Codex session.
6. CI and CodeRabbit gate
   - Handoff-only local files usually are not pushed.
   - If a public doc or skill changed, run the targeted tests that cover the public surface.
7. Local-only boundary gate
   - Treat `.docs/handoff/` as local-only unless the user explicitly asks for a sanitized public example.
   - Confirm `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff` remains empty.

## Lifecycle Cadence

Use this sequence for each non-trivial implementation session:

1. `check`: start by reading the handoff files and reporting whether the next task is actionable.
2. `update`: after implementation or review status changes, refresh current state without turning current files into an archive.
3. `archive`: when the session closes, preserve completed work, verification, PR state, and the exact next step.

Do not skip `archive` when a branch was pushed, a PR was opened, CodeRabbit changed state, CI changed state, or the next session needs a different first command.

## Check Output

For a check, return:

- status: `PASS`, `WARN`, or `INIT_REQUIRED`
- files inspected
- top active task
- first command for the next session
- missing or stale context

## Update Output

For an update, return the files changed, the new first task, remaining blockers, and verification performed.

## Archive Output

For an archive, preserve enough state for a fresh Codex session to resume without guessing:

- next-session quick-start
- current branch
- current commit
- PR/CodeRabbit/CI state
- completed work
- remaining tasks
- verification commands and results
- local-only boundary status
