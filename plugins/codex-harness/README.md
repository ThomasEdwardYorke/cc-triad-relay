# Codex Harness Adapter

This plugin is the Codex-native adapter for the cc-triad-relay Harness. It
exposes skills instead of command or agent files, while keeping the same
workflow intent: repository checks, TDD, handoff hygiene, local review, CI, and
CodeRabbit-aware PR follow-up. Review and implementation skills also require a
Codex second-opinion gate before any branch or PR is reported clear.

Install it from a checkout of this repository:

```bash
codex plugin marketplace add /path/to/project
```

Then enable `codex-harness` from the project marketplace.
Use the marketplace name configured by the project.

## Entry Skills

- `harness-work`: choose the right work mode and dispatch a task through the quality gates.
- `tdd-implement`: run one implementation task through RED, GREEN, refactor, and review.
- `session-handoff`: inspect or update handoff files without leaking local state into the public repo.
- `coderabbit-review`: inspect PR review feedback and keep fixes scoped to actionable findings.
- `pseudo-coderabbit-loop`: run a local CodeRabbit-style pre-review before pushing.
- `new-feature-branch`: create a clean feature branch from the integration branch.
- `branch-merge`: merge one reviewed feature PR into the integration branch.
- `harness-release`: prepare and verify release PRs from integration to release branch.
- `harness-merge-train`: merge multiple ready PRs in order with fail-fast gates.

## Second Opinion Contract

Implementation and review skills use this portable gate:

1. Try a Codex sub-agent when delegated review is available.
2. Fall back to an authenticated `codex` CLI on `PATH`.
3. If neither path is available, fail closed with `BLOCKED`.

The reviewer receives the diff, PR context, and test results, then returns
`PASS | NEEDS_FIX | BLOCKED` with actionable findings. A branch, local review,
or PR is not clear unless the second opinion returns `PASS`.

## Branch And Release Contract

Codex branch and release skills keep normal feature work on the project's
integration branch. Release-branch exposure must go through a release PR, and
the skills explicitly block direct pushes to `main`.

Before a feature merge, merge train, or release PR is reported clear, the skill
must verify CI, CodeRabbit, Codex second opinion where applicable, and the
local-only boundary:

```bash
git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff
```

## Boundary

Codex metadata lives in this plugin root. Claude Code adapter metadata lives in
its own adapter root. Shared behavior should be expressed as portable workflow
rules, not copied platform-specific metadata.
