# Architecture

## High level

```
Claude Code session
        │
        ▼
hooks/hooks.json  (registered per plugin install)
        │ stdin JSON (tool_name + tool_input)
        ▼
scripts/hook-dispatcher.mjs  (thin ES-Modules shim, no logic)
        │ import ${CLAUDE_PLUGIN_ROOT}/core/dist/index.js
        ▼
core/src/index.ts  (routes by hook type)
        │
        ├── guardrails/pre-tool.ts    → guardrails/rules.ts  (R01–R13)
        ├── guardrails/post-tool.ts   → guardrails/tampering.ts (T01–T12)
        ├── guardrails/permission.ts  (auto-approve safe commands)
        └── state/store.ts            (JSON file store for sessions/signals/…)
        │
        ▼ stdout JSON { decision, reason?, systemMessage?, continue?,
                        stopReason?, suppressOutput?, worktreePath? }
Claude Code enforces the decision
```

> **Exception — `WorktreeCreate` blocking hook**: unlike every other event,
> `WorktreeCreate` fully **replaces** Claude Code's default `git worktree add`
> behavior. It follows the official *command* hook contract (see
> <https://code.claude.com/docs/en/hooks>) — on success it prints the raw
> absolute worktree path to stdout (no JSON envelope), and any non-zero exit
> causes worktree creation to fail. The dispatcher (`scripts/hook-dispatcher.mjs`)
> and `core/src/index.ts main()` both have a `worktree-create` branch that
> honors this blocking contract end-to-end; all other events continue to use
> the JSON-decision protocol shown above.

## Layers

1. **Guardrails** — 13 declarative rules. Domain-neutral defaults plus 3
   parameter-driven rules (R10 / R11 / R13) that can be enabled per project.
2. **Skills** — 19 slash-invoked skills: 5 verb skills (`plan` / `work` / `review` / `release` / `setup`) plus 14 workflow skills, packaged under `commands/` for compatibility with Claude Code's command-file loading.
3. **Agents** — 7 specialised agents: 5 native agents (`worker` / `reviewer` /
   `scaffolder` / `security-auditor` / `context-audit-agent`) plus 2 optional
   Codex-backed helpers (`codex-sync`, `coderabbit-mimic`).
4. **State** — pure-JS JSON file at `<projectRoot>/.claude/state/harness.json`.
   No native SQLite. Single-process safe.

## Configuration precedence

1. `harness.config.json` at the project root — user-authored values
2. `DEFAULT_CONFIG` in `core/src/config.ts` — applied for any unset field
3. Environment variables (`HARNESS_WORK_MODE`, `HARNESS_CODEX_MODE`,
   `HARNESS_BREEZING_ROLE`) override narrow flags at evaluation time

Unknown fields in `harness.config.json` are ignored (forward compatibility).

## Design invariants

- Plugin root paths are resolved via `${CLAUDE_PLUGIN_ROOT}`. The dispatcher
  never uses `../../` or ad-hoc traversal — `${CLAUDE_PLUGIN_ROOT}/core/dist/…`
  is always valid post-install.
- Every rule evaluates a `RuleContext` that carries the loaded `HarnessConfig`.
  Empty config arrays mean "off", never "error".
- Every hook path **except `WorktreeCreate`** fails open on errors. A
  malformed input JSON or a missing core build approves the tool call rather
  than blocking the user. `WorktreeCreate` is the one event whose official
  contract is **blocking** (raw stdout + non-zero exit fails worktree
  creation); the dispatcher `failOpen()` routine has a `worktree-create`
  special case that writes the failure to stderr and exits 1 so the
  end-to-end contract is preserved even when the dispatcher itself fails
  (e.g. `CLAUDE_PLUGIN_ROOT` unset, `core/dist` missing).

## Official reference patterns used

- https://code.claude.com/docs/en/skills — Claude Code official skills model:
  Custom commands have been merged into skills, and existing
  `.claude/commands/` files keep working. Harness docs should stay
  skill-first and not command-only.
- https://code.claude.com/docs/en/plugins — create plugins; plugins can include skills, agents, hooks, MCP servers, LSP servers, and monitors.
- https://code.claude.com/docs/en/plugins-reference — manifest and component
  reference for plugin-packaged skills, agents, hooks, MCP, LSP, monitors,
  themes, output styles, and marketplace behavior.
- https://code.claude.com/docs/en/worktrees — worktree isolation, including
  `--worktree`, `.worktreeinclude`, subagent worktrees, and worktree lifecycle.
- https://code.claude.com/docs/en/sub-agents — custom subagents, scopes,
  frontmatter, CLI-defined agents, and plugin agents.
- https://code.claude.com/docs/en/hooks — lifecycle hooks, command hook
  contract, and worktree hook behavior.
- https://code.claude.com/docs/en/mcp — MCP configuration, scopes,
  plugin-provided MCP servers, tool search, and managed MCP policy.
- https://code.claude.com/docs/en/settings — managed, user, project, and local
  settings; permissions; sandboxing; plugin and subagent configuration.
- https://code.claude.com/docs/en/github-actions — Claude Code CI and GitHub
  Actions automation surface.
- https://code.claude.com/docs/en/agent-sdk/overview — Agent SDK orchestration
  for custom automation beyond the plugin runtime.
- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — per-tool matchers (one entry per tool to avoid
  relying on unverified regex-OR behaviour)
- `bin/` — `harness` CLI added to the Bash `PATH` while the plugin is enabled
- `${CLAUDE_PLUGIN_ROOT}` — plugin install directory

See the Claude Code plugin reference for the canonical definitions.
