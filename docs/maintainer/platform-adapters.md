# Platform Adapters

cc-triad-relay keeps the Harness workflow portable by separating platform
metadata from shared workflow intent. The adapters can share concepts and
quality gates, but each platform owns its own install surface and entrypoint
format.

## Adapter Ownership

| Adapter | Public surface | Entrypoint model | Owns |
| --- | --- | --- | --- |
| Claude Code adapter | `plugins/harness/` | Commands, agents, hooks, schemas | Claude Code manifest, command specs, agent prompts, hook dispatch |
| Codex adapter | `plugins/codex-harness/` | Skills | Codex manifest, Codex skills, repo-local Codex marketplace entry |

## Metadata Rules

- Claude Code adapter metadata stays with the Claude Code adapter.
- Codex adapter metadata stays with the Codex adapter.
- `.agents/plugins/marketplace.json` is the repo-local Codex marketplace catalog.
- `plugins/codex-harness/.codex-plugin/plugin.json` is the Codex plugin manifest.
- Codex adapter entrypoints are `skills/**/SKILL.md`, not copied command or agent files.
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

## Local-Only Boundary

The Harness can develop itself, but live self-hosting state is not part of the
public adapter surface.

Local-only paths:

- `.docs/handoff/`
- `harness.config.json`
- `docs/maintainer/handoff/`

Release and feature PRs must keep this check empty:

```bash
git ls-files -- harness.config.json docs/maintainer/handoff
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
