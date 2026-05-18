# Official-doc Maximization Audit

Date: 2026-05-19

This audit pins the next Harness adapter work to current official documentation,
not to local self-hosting habits. The goal is a capability matrix that keeps
Claude Code and Codex adapter decisions source-backed, public, and split into
small follow-up changes.

## Official Sources

OpenAI Codex:

- https://developers.openai.com/codex/concepts/customization
- https://developers.openai.com/codex/plugins/build
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/guides/agents-md
- https://developers.openai.com/codex/config-reference

Claude Code:

- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/github-actions
- https://code.claude.com/docs/en/agent-sdk/overview

Not Found: an official one-to-one Codex command-file manifest equivalent to
Claude Code `commands/`. Codex uses plugin skills as the public entry surface,
so command compatibility must be expressed as skill parity, not copied command
metadata.

## Capability Matrix

| Axis | Claude Code official surface | Codex official surface | Harness status | Next slice |
| --- | --- | --- | --- | --- |
| skills | `SKILL.md` directories, bundled skills, dynamic context, optional subagent execution, and legacy `commands/` compatibility | `SKILL.md` directories in global, repo, or plugin skill roots with progressive disclosure | Both adapters expose workflow primitives through skills or skill-equivalent command docs | T-021 for Claude Code skill metadata tightening, T-022 for Codex skill docs and config tightening |
| commands | Custom commands are merged into skills; existing `.claude/commands/` files still work | Not Found as a direct command manifest surface | Claude adapter keeps existing commands; Codex adapter intentionally does not copy them | T-021 should mark command-to-skill migration guidance without removing compatibility |
| agents/subagents | Project, user, plugin, CLI-defined, and managed subagents; frontmatter supports tools, model, permission mode, MCP, hooks, skills, memory, effort, and worktree isolation | Custom subagents live under `.codex/agents/` or `~/.codex/agents/`; global agent caps include max threads, depth, and runtime | Codex adapter ships role templates; Claude adapter already has plugin agents | T-021 and T-022 should align role docs with current frontmatter/config names |
| hooks | Rich lifecycle hooks, including tool, prompt, stop, notification, session, and worktree events; hooks can live in settings, project files, and plugins | Hooks and plugin hooks are separate feature flags; command handlers are the portable hook body | Codex hook bundle is intentionally narrower than Claude Code hook coverage | T-021 should document Claude-only hook breadth; T-022 should preserve Codex feature-flag and trust requirements |
| MCP | `.mcp.json`, scoped MCP servers, plugin-provided MCP, environment expansion, remote HTTP, stdio, OAuth, and tool search | TOML config plus plugin `mcpServers` entries and optional external context | Codex adapter already ships optional OpenAI docs MCP disabled by default | T-022 should add current-source guidance for optional MCP failures |
| worktrees | First-class `--worktree`, `.worktreeinclude`, subagent worktree isolation, and worktree lifecycle hooks | Codex supports subagent delegation and sandbox policy, but worktree orchestration remains harness-managed | Harness models preserve isolated worktrees as workflow intent, not identical implementation | T-021 should maximize Claude worktree docs; T-023 should evaluate cross-adapter worktree outcomes |
| config | Settings scopes cover managed, user, project, and local layers, with plugin, subagent, hook, sandbox, and worktree settings | `~/.codex/config.toml` and trusted project `.codex/config.toml`; project config cannot override provider, auth, telemetry, or profile routing | Codex setup template documents project-scoped safe keys | T-022 should add current config-key guardrails and stale-key tests |
| permissions | Permission modes, allow and deny rules, sandbox settings, managed policy, and path prefixes | Sandbox mode, approval policy, managed permissions, web search, MCP approval modes, and auto review policy | Both adapters document local-only boundary and fail-closed review gates | T-021/T-022 should keep permission docs platform-native |
| models | Model configuration and effort controls appear in settings, skills, and subagents | `model`, `review_model`, per-subagent model and reasoning effort, and skill enablement config | Codex setup template pins conservative defaults | T-022 should refresh model/effort guidance from official Codex config names |
| automation | Non-interactive CLI, schedules, GitHub Actions, GitLab CI/CD, Agent SDK, channels, and plugin/SDK loading | `codex exec`, Codex Action, hooks, MCP, auto review, and optional apps/connectors | Codex CI remains CI-optional unless maintainers promote it | T-023 should define repeatable evaluation loops before making automation release-blocking |
| CI | Official GitHub Actions and CI review surfaces exist for Claude Code | Codex Action can produce focused review artifacts | GitHub CI and CodeRabbit remain release-blocking sources | T-023 should measure signal quality before any required-CI promotion |

## PR-sized Follow-up Plan

T-021: Claude Code official-feature uplift.

- Refresh Claude adapter docs against current skills, plugins, agents,
  worktrees, hooks, MCP, settings, GitHub Actions, and Agent SDK pages.
- Add tests that prevent stale command-only guidance where skills are now the
  official abstraction.
- Keep Claude-only primitives explicit instead of forcing Codex parity.

T-022: Codex official-feature uplift.

- Refresh Codex adapter docs and setup templates against current Codex
  customization, plugin, hook, subagent, AGENTS.md, and config-reference pages.
- Add tests for config-key drift, hook feature flags, plugin path rules, MCP
  optionality, and second-opinion gate wording.
- Preserve Codex-native skill and plugin surfaces without importing Claude Code
  metadata.

T-023: Eval and self-improve loop.

- Add a repeatable adapter evaluation checklist that compares workflow outcomes
  across planning, TDD, review, branch, merge, handoff, and public/local
  boundary gates.
- Feed session retrospectives into backlog candidates only when the root cause
  is generic Harness behavior, not consumer project state.
- Keep automation local-only or CI-optional until measured signal quality is
  high enough to justify a release-blocking gate.
- Publish the durable loop in
  `docs/maintainer/adapter-evaluation-self-improve-loop.md`, and keep
  `harness-self-improve` aligned with that intake policy.

## Review Gates

- Local tests must cover any edited adapter docs, manifests, templates, or
  public boundary rules.
- Run CodeRabbit CLI before push on each implementation branch:

```bash
coderabbit review --agent --base dev --type committed
```

- PR review remains the external review loop. CodeRabbit CLI is a pre-push
  review aid and does not replace PR CodeRabbit clear state.
- Public docs must not include local-only handoff state, private paths, active
  feature branches, pull request state, or commit identifiers.
