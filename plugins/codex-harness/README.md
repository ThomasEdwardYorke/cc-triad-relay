# Codex Harness Adapter

This plugin is the Codex-native adapter for the cc-triad-relay Harness. It
exposes skills and optional Codex plugin hooks instead of command or agent
files, while keeping the same workflow intent: repository checks, TDD, handoff
hygiene, local review, CI, and CodeRabbit-aware PR follow-up. Review and
implementation skills also require a Codex second-opinion gate before any
branch or PR is reported clear.

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

## Durable Guidance And Setup Contract

`harness-setup` owns Codex project setup. It can guide or create a concise
`AGENTS.md` plus project-scoped `.codex/config.toml` from:

- `skills/harness-setup/assets/AGENTS.md.tmpl`
- `skills/harness-setup/assets/codex-config.toml.tmpl`

The `AGENTS.md` template keeps durable guidance short and points to
task-specific references. The `.codex/config.toml` template documents
project-scoped defaults for `model`, `review_model`, `approval_policy`,
`sandbox_mode`, `sandbox_workspace_write.network_access`, MCP via
`mcp_servers`, plugin hooks via `features.hooks` / `features.plugin_hooks`,
and review-policy guidance through `auto_review.policy`.

Project-scoped config is public only when it is generic. Keep personal machine
paths, credentials, active branch notes, PR state, and handoff session state in
ignored local files.

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

## Subagent And Worktree Parity Contract

`codex-team` ships project-scoped custom agent templates for `.codex/agents/`:

- `implementation_worker`
- `reviewer`
- `adversarial_auditor`
- `release_verifier`
- `handoff_docs_checker`

The role templates live under `skills/codex-team/assets/agents/` and stay
generic until a project copies or adapts them. Respect Codex's
`agents.max_threads` cap, keep `agents.max_depth` bounded, and use
`MAX_CODEX_PARALLEL` so subagent work keeps bounded concurrency. Do not set
`agents.max_threads` in shared project config while Codex `multi_agent_v2`
rejects that key.

Model A maps to read-only Codex subagents for exploration, review, and handoff
checks while the coordinator owns the writable feature branch. Model B maps to
isolated worktrees for independent writable tasks with explicit `owned_files`,
`forbidden_files`, and deterministic merge order. tmux optional: it can present
parallel sessions for operators, but Codex parity relies on subagents and
isolated worktrees, not a hard tmux dependency.

Read-only roles must still account for parent runtime overrides. If the parent
Codex session is running with danger-full-access, yolo-style approval changes,
or another broader runtime override, use an explicit read-only launch for
review, adversarial audit, release verification, and handoff/docs checks before
treating the result as independent read-only evidence.

## Plugin Hook Contract

This adapter bundles `./hooks/hooks.json` and points to it from
`.codex-plugin/plugin.json`. Plugin hooks are off by default in the current
Codex release, so enable both hook layers before expecting these hooks to run:

```toml
[features]
hooks = true
plugin_hooks = true
```

After enabling the flags and this plugin, restart Codex and run `/hooks` to
review and trust the non-managed plugin hooks.

The bundled hook dispatcher is deterministic and testable without a live Codex
session:

- `PreToolUse` blocks destructive shell paths and local-only publication commands.
- `PermissionRequest` denies the same unsafe escalations before the normal approval prompt.
- `UserPromptSubmit` blocks prompts that appear to contain common secret shapes.
- `Stop` reminds the operator to report tests, review/CodeRabbit status, and handoff/archive state before ending implementation work.

The hooks use `${PLUGIN_ROOT}` and stay under `plugins/codex-harness/hooks/`.
They do not depend on `CLAUDE_PLUGIN_ROOT` or Claude Code hook metadata.

## Boundary

Codex metadata lives in this plugin root. Claude Code adapter metadata lives in
its own adapter root. Shared behavior should be expressed as portable workflow
rules, not copied platform-specific metadata.
