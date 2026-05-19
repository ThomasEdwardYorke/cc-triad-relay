---
name: harness-plan
description: Convert clarified requirements into Harness-managed tasks with acceptance criteria and handoff-aware status.
---

# harness-plan

Use this skill when the user asks Codex to create, review, or sync a Harness-managed implementation plan before code changes start.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the real worktree root, branch, upstream, and dirty status.
   - Planning can run on the integration branch, but implementation still needs a feature branch.
2. Plan source-of-truth gate
   - Prefer configured handoff files when they exist.
   - Use `Plans.md` only for repositories that still use plans-mode.
   - Do not invent a tracker path when no local or user-supplied source exists.
3. Task split gate
   - Split work into independently reviewable tasks with explicit dependencies.
   - Keep each task small enough for RED, GREEN, focused verification, and review.
4. Acceptance criteria gate
   - Every implementation task needs observable acceptance criteria.
   - Mark docs-only, research-only, and implementation tasks differently.
5. Review and sync gate
   - Compare planned tasks with existing code and handoff state before adding duplicates.
   - For sync work, report mismatches before editing any tracker file.
6. Local-only boundary gate
   - Keep active handoff under local-only paths.
   - Do not commit `.docs/handoff/` or live `harness.config.json`.

## Workflow

1. Read the user request, handoff files, and existing roadmap/backlog or `Plans.md`.
2. Identify the next dispatchable task and the later tasks that should remain pending.
3. Write acceptance criteria that can drive RED and GREEN work.
4. For handoff-managed repositories, update current/backlog/roadmap consistently when the user asks for an applied plan.
5. End with the chosen next task, suggested branch, dependencies, and verification strategy.

## Completion Contract

Report the plan source, task list, selected next task, acceptance criteria, files changed or left read-only, and local-only boundary status.
