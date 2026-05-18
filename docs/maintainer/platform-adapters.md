# Platform Adapters

cc-triad-relay keeps the Harness workflow portable by separating platform
metadata from shared workflow intent. The adapters can share concepts and
quality gates, but each platform owns its own install surface and entrypoint
format.

## Adapter Ownership

| Adapter | Public surface | Entrypoint model | Owns |
| --- | --- | --- | --- |
| Claude Code adapter | `plugins/harness/` | Commands, agents, hooks, schemas | Claude Code manifest, command specs, agent prompts, hook dispatch |
| Codex adapter | `plugins/codex-harness/` | Skills, optional plugin hooks | Codex manifest, Codex skills, Codex hook config, repo-local Codex marketplace entry |

## Metadata Rules

- Claude Code adapter metadata stays with the Claude Code adapter.
- Codex adapter metadata stays with the Codex adapter.
- `.agents/plugins/marketplace.json` is the repo-local Codex marketplace catalog.
- `plugins/codex-harness/.codex-plugin/plugin.json` is the Codex plugin manifest.
- Codex adapter entrypoints are `skills/**/SKILL.md` and Codex plugin hook
  config under `hooks/**`, not copied command or agent files.
- Claude-only primitive surfaces such as `claude-oneshot` and
  `parallel-worktree-v2` are documented as non-equivalents, not copied as
  direct Codex skills.

## Shared Workflow Rules

Both adapters preserve the same operating intent:

- verify repository, branch, and dirty status before editing
- read handoff or backlog context when present
- use RED, GREEN, refactor, and local review for implementation work
- require a Codex second-opinion gate before marking implementation or review
  work clear
- run targeted tests before broad verification
- use local pseudo-CodeRabbit review before push when useful
- use PR, CI, and CodeRabbit feedback after push
- keep public plugin files generic and portable

For the Codex adapter, the second-opinion gate is intentionally portable:
try a Codex sub-agent first, fall back to an authenticated `codex` CLI, and
fail closed with `BLOCKED` when neither path is available. The review input is
the diff, PR context, and test results; the output must be
`PASS | NEEDS_FIX | BLOCKED` plus actionable findings.

## Codex Durable Guidance And Setup

Codex setup parity is implemented through `harness-setup` guidance plus
copy-ready setup assets under
`plugins/codex-harness/skills/harness-setup/assets/`.

- `AGENTS.md.tmpl` is the concise durable-guidance starting point. It should
  hold stable repository expectations and point to task-specific references.
- `codex-config.toml.tmpl` is the project-scoped `.codex/config.toml` starting
  point. It documents `model`, `review_model`, `approval_policy`,
  `sandbox_mode`, `sandbox_workspace_write.network_access`, MCP
  (`mcp_servers`), plugin hook flags (`features.hooks` /
  `features.plugin_hooks`), and `auto_review.policy`.
- Project-scoped setup files are publishable only when they stay generic.
  Personal machine paths, credentials, active branch state, PR state, and
  handoff session notes remain local-only.

## Codex Subagent And Worktree Parity

Codex subagent parity is implemented through project-scoped `.codex/agents/`
templates shipped by `codex-team` plus the `parallel-worktree` orchestration
contract.

- Role templates cover `implementation_worker`, `reviewer`,
  `adversarial_auditor`, `release_verifier`, and `handoff_docs_checker`.
- Codex's `agents.max_threads` cap, configured `agents.max_depth`, and
  workflow `MAX_CODEX_PARALLEL` bound concurrency before any parallel work
  starts. Shared config should not set `agents.max_threads` while Codex
  `multi_agent_v2` rejects that key.
- Model A uses read-only subagents for exploration, review, release
  verification, and handoff/docs checks while the coordinator owns writes.
- Model B uses isolated worktrees for independent writable tasks with explicit
  `owned_files`, `forbidden_files`, and deterministic merge order.
- Parent runtime overrides can broaden spawned-agent execution context; use an
  explicit read-only launch for Model A review, release, and handoff roles when
  the coordinator session is running with broader sandbox or approval overrides.
- tmux optional: tmux may still help an operator present sessions, but Codex
  parity must not depend on tmux being present.

## Codex Plugin Hook Foundation

Codex hook parity is implemented as a Codex-native plugin hook bundle under
`plugins/codex-harness/hooks/`. The Codex manifest points at
`./hooks/hooks.json`, and the dispatcher uses `${PLUGIN_ROOT}` so installed
plugin paths remain portable.

Plugin hooks are off by default in the current Codex release. Operators must
enable both hook layers before bundled plugin hooks can run:

```toml
[features]
hooks = true
plugin_hooks = true
```

After enabling the flags, Codex requires non-managed hooks to be reviewed and
trusted through `/hooks`.

The initial Codex hook foundation covers deterministic, testable guardrails:

- `PreToolUse` for tool guardrails and local-only publication blocks.
- `PermissionRequest` for unsafe escalation denial.
- `UserPromptSubmit` for prompt secret checks.
- `Stop` for completion evidence reminders before session finalization.

## Local-Only Boundary

The Harness can develop itself, but live self-hosting state is not part of the
public adapter surface.

Local-only paths:

- `.docs/handoff/`
- `harness.config.json`
- `docs/maintainer/handoff/`

Release and feature PRs must keep this check empty:

```bash
git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff
```

Generic maintainer process docs may live under `docs/maintainer/` only after
they have been rewritten to remove active session state, private branch notes,
personal paths, and test-bed-only assumptions.

## PR Staging

This adapter work should stay staged by capability:

1. Codex plugin foundation plus the minimum TDD and handoff flow.
2. Review, CodeRabbit, and GitHub CI fix flow.
3. Branch, release, and merge-train flow.
4. Parallel worktree and multi-Codex orchestration.
5. Codex-native guardrail scripts or MCP surfaces that replace hook-only behavior.

## Intentional Non-Equivalents

The parity target is equivalent operator outcome, not identical file layout.
The following Claude-only primitive names remain intentionally absent from
`plugins/codex-harness/skills/`:

- `claude-oneshot` wraps a top-level `claude -p` process and stream-json log
  output. Codex should use `codex-team`, `codex exec`, or Codex subagents.
- `parallel-worktree-v2` coordinates top-level Claude sessions through tmux.
  Codex should use Codex subagents and isolated worktrees through
  `parallel-worktree`.

These primitives are not copied as direct Codex skills because they encode
Claude Code process and tmux assumptions. Codex subagents and isolated
worktrees are the Codex-native replacement surface.
