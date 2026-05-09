# cc-triad-relay — Decisions

**Last updated**: 2026-05-10

This file is append-only. Add new decisions at the end; do not edit or delete existing entries.

## D-001: Use a three-branch maintainer flow (Date: 2026-05-10)

**Decision**: Use `feature/* -> dev -> main` for maintainer development.

**Why**: `main` is a public branch and should remain release-ready. `dev` gives maintainers an integration branch for self-hosted harness work and release preparation.

**How to apply**: Normal implementation starts from `dev`, opens PRs into `dev`, and reaches `main` only through a release PR from `dev`.

## D-002: Track self-hosting handoff under docs/maintainer/handoff (Date: 2026-05-10)

**Decision**: Store the harness repository's own handoff docs in `docs/maintainer/handoff/`, not repo-root `.docs/handoff/`.

**Why**: Root `.docs/` is intentionally ignored for local-only notes, while this repository needs a shared maintainer source of truth. `docs/maintainer/` is already the accepted zone for repo-specific maintainer context that is not shipped as plugin runtime behavior.

**How to apply**: Root `harness.config.json` points `work.handoffPaths` to `docs/maintainer/handoff/cc-triad-relay-*.md`.

## D-003: Treat script_generate harness material as historical evidence (Date: 2026-05-10)

**Decision**: Do not directly copy old `script_generate` harness snapshots into the active backlog without triage.

**Why**: `script_generate` contains predecessor `Plans.md` and `claude-code-harness-main` snapshots from earlier architecture phases. They explain how this harness evolved, but many items are stale or already superseded by the current `cc-triad-relay` codebase.

**How to apply**: Future sessions may read those snapshots, but must convert only current, actionable work into `cc-triad-relay-backlog.md`.

## D-004: Branch protection is required before trusting convention (Date: 2026-05-10)

**Decision**: The branch strategy is not complete until GitHub protects `main`, and preferably `dev`.

**Why**: Local discipline prevents accidental work on `main` during agent sessions, but public repository safety depends on server-side rules.

**How to apply**: Configure `main` to require PRs and CI before merge; configure `dev` similarly if the repository permission model allows it.
