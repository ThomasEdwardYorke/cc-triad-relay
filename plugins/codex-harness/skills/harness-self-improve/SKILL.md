---
name: harness-self-improve
description: Mine session handoff archives and review notes for reusable Harness improvement tasks without auto-pushing changes.
---

# harness-self-improve

Use this skill when the user asks Codex to turn session retrospectives, handoff archives, review loops, or recurring failures into Harness improvement candidates.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve repository root, branch, upstream, and dirty status.
   - Identify whether the session archive belongs to this repository or a downstream dogfood project.
2. Archive mining gate
   - Read concrete `session-handoff archive` files, review summaries, or CI/CodeRabbit records before proposing improvements.
   - Do not invent lessons from memory when an archive or log is available.
3. Adapter evaluation gate
   - Compare Claude Code adapter and Codex adapter outcomes across planning, TDD, review, branch, merge, handoff, and public/local boundary gates.
   - Feed backlog candidates only when the root cause is generic Harness behavior, not consumer project state.
   - Keep CodeRabbit CLI as pre-push evidence and PR CodeRabbit as the external PR review loop.
4. Candidate quality gate
   - Normalize each candidate by origin, severity, scope, proposed action, and testability.
   - Deduplicate against existing backlog and roadmap items.
   - Require acceptance criteria before a candidate is accepted.
5. Proposal boundary gate
   - Default to read-only proposals.
   - With explicit apply mode, update only the configured backlog or handoff file.
   - Do not commit, push, open PRs, or resolve external review state from this skill.
6. Backlog update gate
   - Add only PR-sized, acceptance-criteria-backed tasks.
   - Keep project-specific dogfood lessons out of shipped plugin docs unless generalized.
   - Classify automation candidates as local-only, CI-optional, or release-blocking before proposing a gate change.
   - Include signal quality, false positives, false negatives, time-to-clear, defects caught, and docs drift when those metrics change the decision.
   - Name promotion criteria plus demotion or rollback triggers for any stronger gate.
7. Local-only boundary gate
   - Keep active `.docs/handoff/` archives local unless the project intentionally publishes a sanitized maintainer record.
   - Do not leak private paths, branch names, or session IDs into public plugin surfaces.

## Workflow

1. Select the archive range or use the latest session archive.
2. Extract open issues, anti-pattern observations, review findings, CI failures, and handoff gaps.
3. Classify each candidate as plugin-spec, docs, tests, infrastructure, or consumer-only.
4. Propose backlog entries with acceptance criteria and a suggested branch when useful.
5. If the user requested apply mode, update the configured local backlog and report the diff.
6. When the session is ending, verify `session-handoff update` has captured accepted candidates and skipped consumer-only lessons.

## Completion Contract

Report archive inputs, candidates accepted, candidates skipped, backlog updates, PR draft suggestions, and local-only boundary status.
