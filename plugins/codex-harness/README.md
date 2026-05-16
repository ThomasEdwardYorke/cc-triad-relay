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
- `clarify`: resolve ambiguous requirements one question at a time before planning or code changes.
- `harness-plan`: convert clarified requirements into handoff-aware tasks and acceptance criteria.
- `harness-review`: run read-only code, plan, scope, setup, or Harness integrity reviews.
- `harness-setup`: initialize, inspect, or verify Harness configuration for Codex-managed projects.
- `tdd-implement`: run one implementation task through RED, GREEN, refactor, and review.
- `session-handoff`: inspect or update handoff files without leaking local state into the public repo.
- `context-audit`: inspect context sources for size, discoverability, dead links, and stale entrypoints.
- `coderabbit-review`: inspect PR review feedback and keep fixes scoped to actionable findings.
- `pseudo-coderabbit-loop`: run a local CodeRabbit-style pre-review before pushing.
- `new-feature-branch`: create a clean feature branch from the integration branch.
- `branch-merge`: merge one reviewed feature PR into the integration branch.
- `harness-release`: prepare and verify release PRs from integration to release branch.
- `harness-merge-train`: merge multiple ready PRs in order with fail-fast gates.
- `harness-self-improve`: mine session archives and review notes for reusable Harness improvement tasks.
- `parallel-worktree`: coordinate isolated Codex worktrees with bounded concurrency.
- `codex-team`: request delegated Codex implementation, review, or adversarial checks.

## Claude-Only Primitive Equivalents

Two Claude Code primitives are intentionally not copied as direct Codex skills:

- `claude-oneshot` is a Claude-only primitive for spawning `claude -p` and writing stream-json logs. Codex should use `codex-team`, `codex exec`, or Codex subagents instead.
- `parallel-worktree-v2` is a Claude/tmux Model B launcher. Codex should use Codex subagents and isolated worktrees through `parallel-worktree` rather than requiring tmux or a top-level Claude process.

These are Claude-only primitive names, not missing Codex files. The Codex
adapter preserves the operator outcome through Codex subagents and isolated
worktrees, while avoiding a literal copy of Claude Code command metadata.
Codex subagents and isolated worktrees are the parity surface for this path.

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

## Parallel Orchestration Contract

Codex parallel orchestration uses isolated worktrees and explicit ownership
contracts instead of sharing one writable checkout. Each delegated task declares
`owned_files` and `forbidden_files`, and the coordinator bounds active workers
with `MAX_CODEX_PARALLEL`. Work is integrated in deterministic merge order, with
checks and Codex second opinion rerun after each accepted task branch.

Parallel work may prepare a feature branch or PR against the integration
branch. It must not push directly to `main`; release exposure still happens
only through a release PR.

`parallel-worktree-v2` and `claude-oneshot` remain Claude-only primitive
surfaces. They are not copied as direct Codex skills because Codex has its own
subagent, CLI, and isolated-worktree paths.

## Boundary

Codex metadata lives in this plugin root. Claude Code adapter metadata lives in
its own adapter root. Shared behavior should be expressed as portable workflow
rules, not copied platform-specific metadata.
