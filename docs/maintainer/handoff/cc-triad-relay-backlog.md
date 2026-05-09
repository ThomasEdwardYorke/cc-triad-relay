# cc-triad-relay — Backlog

**Last updated**: 2026-05-10

This is the active dispatchable view for maintainer work on the harness repository itself.

## Top Priority

### [High] T-001 Bootstrap self-hosting branch and handoff docs

```yaml
id: T-001
priority: High
status: done
roadmap_ref: phase-1.week-1.bootstrap-self-hosting
depends_on: []
```

Acceptance criteria:

- `dev` exists and tracks `origin/dev`.
- Normal work happens on `feature/*`, not directly on `main`.
- Root `harness.config.json` points to the tracked maintainer handoff files.
- `CONTRIBUTING.md`, PR template, and release docs explain `feature/* -> dev -> main`.
- Existing `script_generate` harness material is documented as historical input, not blindly copied.

### [High] T-002 Reconstruct active work from historical harness snapshots

```yaml
id: T-002
priority: High
status: pending
roadmap_ref: phase-1.week-1.reconstruct-active-handoff
depends_on: [T-001]
```

Acceptance criteria:

- Read the two `script_generate/.docs/claude-code-harness-main*/Plans.md` snapshots.
- Separate obsolete v3/v25/v26 items from still-relevant invariants.
- Move only current, actionable maintainer work into this backlog.
- Record rejected historical items in `test-bed-usage.md` or a maintainer note.

### [High] T-003 Align docs that still drift from the current manifest

```yaml
id: T-003
priority: High
status: pending
roadmap_ref: phase-1.week-1.docs-manifest-alignment
depends_on: [T-001]
```

Acceptance criteria:

- Compare `plugins/harness/.claude-plugin/plugin.json`, `README.md`, and `docs/en/commands.md`.
- Fix stale command / agent / hook counts.
- Add or update tests if content-integrity coverage already tracks these counts.

## Medium Priority

### [Medium] T-004 Configure GitHub branch protection

```yaml
id: T-004
priority: Medium
status: pending
roadmap_ref: phase-2.week-2.branch-protection
depends_on: [T-001]
```

Acceptance criteria:

- `main` requires PRs and CI before merge.
- Direct push to `main` is disabled.
- `dev` is protected with PR-only merge if repository permissions allow it.
- Required status checks match the current GitHub Actions workflow names.

### [Medium] T-005 Review remaining remote branches

```yaml
id: T-005
priority: Medium
status: pending
roadmap_ref: phase-2.week-2.branch-cleanup
depends_on: [T-001]
```

Acceptance criteria:

- Re-check `origin/feature/model-b-evolution` and `origin/feature/model-registry`.
- Delete only after confirming no active PR, release dependency, or unmerged work remains.

## Management Rules

- Keep this file below 150 lines when possible.
- Use `status: pending | in_progress | done`.
- Move completed details to release notes or maintainer docs instead of letting this file become an archive.
