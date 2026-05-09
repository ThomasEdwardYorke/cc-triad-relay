# cc-triad-relay — Roadmap

**Last updated**: 2026-05-10

## Phase 1 — Self-hosting Bootstrap

Goal: make this repository safe to develop through its own harness without using `main` as a work branch.

### Week 1 — Bootstrap self-hosting

```yaml
id: phase-1.week-1.bootstrap-self-hosting
phase: 1
week: 1
priority: High
status: done
labels: [docs, process]
```

Acceptance criteria:

- `dev` is the integration branch.
- `feature/*` branches target `dev`.
- `main` is release-ready only.
- Root `harness.config.json` activates tracked handoff mode for this repository.
- Maintainer docs explain the branch policy and handoff source of truth.

### Week 1 — Reconstruct active handoff from historical inputs

```yaml
id: phase-1.week-1.reconstruct-active-handoff
phase: 1
week: 1
priority: High
status: pending
labels: [docs, maintenance]
```

Acceptance criteria:

- Historical harness snapshots from `script_generate` are reviewed.
- Obsolete work is not reintroduced as active work.
- Still-relevant work becomes concrete backlog entries with acceptance criteria.

### Week 1 — Align docs and manifest counts

```yaml
id: phase-1.week-1.docs-manifest-alignment
phase: 1
week: 1
priority: High
status: pending
labels: [docs, test]
```

Acceptance criteria:

- README, command docs, and plugin manifest agree on command / agent / hook counts.
- Integrity tests are updated when the repo already has a count guard.

## Phase 2 — Repository Protection

Goal: move safety from convention into GitHub settings and repeatable release procedure.

### Week 2 — Branch protection

```yaml
id: phase-2.week-2.branch-protection
phase: 2
week: 2
priority: Medium
status: pending
labels: [repo-admin]
```

Acceptance criteria:

- `main` direct pushes are blocked.
- `main` requires PR + CI.
- `dev` requires PR if repository permissions and workflow allow it.

### Week 2 — Branch cleanup

```yaml
id: phase-2.week-2.branch-cleanup
phase: 2
week: 2
priority: Medium
status: pending
labels: [maintenance]
```

Acceptance criteria:

- Remaining historical remote branches are either deleted or explicitly retained with rationale.
