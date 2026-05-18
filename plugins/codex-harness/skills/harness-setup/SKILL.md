---
name: harness-setup
description: Initialize, inspect, or verify Harness configuration for Codex-managed projects without leaking local state.
---

# harness-setup

Use this skill when the user asks Codex to initialize, check, doctor, or explain Harness setup for a repository.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve repository root, branch, upstream, and dirty status before setup changes.
   - Separate setup inspection from implementation work.
2. Setup boundary gate
   - Distinguish public templates from active local runtime state.
   - Ask for confirmation before overwriting existing project guidance or config.
3. Durable guidance gate
   - Prefer a concise `AGENTS.md` that states durable repository expectations.
   - Point to project-relative task-specific references instead of pasting long runbooks.
   - Use `assets/AGENTS.md.tmpl` when creating or refreshing project guidance.
4. Codex config defaults gate
   - Use `assets/codex-config.toml.tmpl` when creating or explaining `.codex/config.toml`.
   - Explain `sandbox_mode`, `approval_policy`, `model`, `review_model`, MCP (`mcp_servers`), subagent limits (`agents.max_depth`, workflow `MAX_CODEX_PARALLEL`, and Codex's default `agents.max_threads` cap), and `auto_review.policy` defaults before applying them.
   - Do not set `agents.max_threads` in shared config when Codex `features.multi_agent_v2` is enabled and rejects that key.
   - Treat project-scoped `.codex/config.toml` as public only when it contains no personal paths, credentials, or active session state.
5. MCP and external context gate
   - Explain that this plugin ships `mcpServers` pointing at `./.mcp.json`, with the OpenAI Codex official docs server disabled by default and optional (`required = false`).
   - Show plugin-scoped opt-in with `plugins."codex-harness".mcp_servers.openaiDeveloperDocs` instead of editing the plugin manifest.
   - Use optional external context only for real manual-loop reduction: current official docs, GitHub review metadata, and selected external contexts that are required by the task.
   - Treat unavailable MCP as a reported warning; fall back to committed docs, `gh`, or local exports where sufficient, and do not block unless the requested task depends on that remote source.
6. Codex CI and non-interactive automation gate
   - Explain repeatable Non-interactive mode through `codex exec` before recommending any GitHub workflow.
   - Default `codex exec` review and summary jobs to `--sandbox read-only`, `--ephemeral`, `--ignore-user-config`, `--json`, and `--output-last-message`; use `--output-schema` only when downstream automation needs stable fields.
   - Use `--sandbox workspace-write` only in isolated fix experiments that rerun the normal verification command before producing a patch.
   - Offer `assets/codex-github-action-review.yml.tmpl` and `assets/codex-review-prompt.md.tmpl` for projects that opt in to `openai/codex-action@v1`.
   - Classify Codex automation as `local-only`, `CI-optional`, or `release-blocking`; GitHub CI remains the release-blocking source until maintainers explicitly require the Codex workflow.
   - CodeRabbit remains the PR review source when configured; do not duplicate CodeRabbit with broad style or nitpick automation.
   - Keep API key material in a project secret such as `CODEX_API_KEY`, never in committed templates.
7. Configuration template gate
   - Prefer generic templates and project-relative paths.
   - Keep `harness.config.json`, `AGENTS.md`, `.codex/config.toml`, and CodeRabbit guidance free of private machine paths.
8. Verification gate
   - Run the repository's harness doctor, manifest checks, or equivalent file-existence checks when available.
   - Report missing optional dependencies separately from blocking setup failures.
9. Local-only boundary gate
   - Never commit live `harness.config.json` unless the project explicitly treats it as public.
   - Keep `.docs/handoff/` out of tracked files.

## Workflow

1. Classify the setup request as `init`, `check`, `doctor`, `build`, or `localize`.
2. Inspect existing Claude Code and Codex adapter files before proposing changes.
3. Apply only idempotent setup edits or provide a clear manual diff when overwrite risk exists.
4. For `init` or `localize`, guide or create:
   - `AGENTS.md` from `assets/AGENTS.md.tmpl`
   - `.codex/config.toml` from `assets/codex-config.toml.tmpl`
5. When the project asks for Codex subagent parity, guide `.codex/agents/` setup from `../codex-team/assets/agents/*.toml.tmpl`.
6. When the project asks for Codex CI automation, guide `.github/workflows/` and `.github/codex/prompts/` setup from the Codex CI templates and label the gate as local-only, CI-optional, or release-blocking before enabling it.
7. Verify plugin manifests, skill directories, hooks/docs references, setup templates, Codex agent templates, Codex CI templates, and optional external tools.
8. End with the exact next command for the operator.

## Completion Contract

Report setup mode, files checked or changed, AGENTS.md / .codex/config.toml status, sandbox / approval / model / MCP / review-policy defaults, verification commands, optional warnings, next command, and local-only boundary status.
