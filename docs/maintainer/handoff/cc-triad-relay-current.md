# cc-triad-relay — Current State

**Last updated**: 2026-05-10

This is the maintainer handoff index for self-hosting `cc-triad-relay` development with the harness itself. It is tracked under `docs/maintainer/handoff/` because repo-root `.docs/` is intentionally ignored for local-only design notes.

## Latest State

| Target | Branch / Commit / Note |
|---|---|
| Repository | `ThomasEdwardYorke/cc-triad-relay` |
| Local path | `/Users/kosukekunii/dev/cc-triad-relay` |
| Production branch | `main` |
| Integration branch | `dev` |
| Active work branch | `feature/bootstrap-harness-handoff` |
| Branch policy | `feature/* -> dev -> main` |
| Task tracker mode | `handoff` via root `harness.config.json` |

## Context

`cc-triad-relay` was developed while dogfooding the harness in another repository, especially `script_generate`. That repository still contains old `claude-code-harness-main` snapshots and predecessor `Plans.md` material. Treat those files as historical evidence, not as the active source of truth for current `cc-triad-relay` work.

Current local evidence found in `script_generate`:

- `/Users/kosukekunii/dev/script_generate/.docs/claude-code-harness-main/Plans.md`
- `/Users/kosukekunii/dev/script_generate/.docs/claude-code-harness-main 2/Plans.md`
- `/Users/kosukekunii/dev/script_generate/Plans.md`

`script_generate` currently has an unrelated dirty `.gitignore`; do not edit that repository during `cc-triad-relay` bootstrap unless explicitly requested.

## Top Priority Next Task

Use `docs/maintainer/handoff/cc-triad-relay-backlog.md` as the active dispatch view. Start from `T-001` unless the user explicitly redirects.

## Quick Start

```bash
cd /Users/kosukekunii/dev/cc-triad-relay
git switch dev
git pull --ff-only
git switch -c feature/<short-slug>
```

Then run:

```text
/harness:session-handoff check
```

Use the result plus `cc-triad-relay-backlog.md` to pick the first task.

## Detail Pointers

| Purpose | File |
|---|---|
| Active backlog | `docs/maintainer/handoff/cc-triad-relay-backlog.md` |
| Roadmap | `docs/maintainer/handoff/cc-triad-relay-roadmap.md` |
| Append-only decisions | `docs/maintainer/handoff/cc-triad-relay-decisions.md` |
| Branch strategy | `docs/maintainer/development-branching.md` |
| Test-bed history | `docs/maintainer/test-bed-usage.md` |
