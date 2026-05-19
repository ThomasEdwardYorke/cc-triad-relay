---
name: clarify
description: Clarify ambiguous requirements before implementation by asking one depth-first question at a time without editing code.
---

# clarify

Use this skill when the user asks Codex to clarify a feature, refactor, migration, bug report, or PRD before planning or implementation.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the repository root, branch, and dirty status when the question depends on existing code.
   - Read relevant local files before asking about facts that the codebase can answer.
2. Decision boundary gate
   - Separate facts already proven from choices the user still needs to make.
   - Keep unresolved choices explicit instead of turning them into implementation assumptions.
3. Question cadence gate
   - Ask one question at a time.
   - Prefer depth-first follow-up on the current decision branch before opening a new branch.
4. No-code gate
   - Do not edit files, create branches, write tests, or change backlog state during clarification.
   - Hand off to `harness-plan` or `harness-work` only after the user has settled the key decisions.
5. Local-only boundary gate
   - Do not write active session decisions into tracked plugin files.
   - If the user asks to preserve the result, write only to the configured local handoff path.

## Workflow

1. Restate the topic in two or three concrete sentences.
2. Identify the first decision branch that blocks planning.
3. Ask a single question with clear trade-offs, a recommended default when appropriate, and one concrete example.
4. After each answer, decide whether to stay on the branch or move to the next blocker.
5. End with the settled decisions, open questions, and the recommended next Harness skill.

## Completion Contract

Report the clarified decisions, unresolved assumptions, files inspected, recommended next skill, and local-only boundary status.
