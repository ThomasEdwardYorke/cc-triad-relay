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
   - Explain `sandbox_mode`, `approval_policy`, `model`, `review_model`, MCP (`mcp_servers`), and `auto_review.policy` defaults before applying them.
   - Treat project-scoped `.codex/config.toml` as public only when it contains no personal paths, credentials, or active session state.
5. Configuration template gate
   - Prefer generic templates and project-relative paths.
   - Keep `harness.config.json`, `AGENTS.md`, `.codex/config.toml`, and CodeRabbit guidance free of private machine paths.
6. Verification gate
   - Run the repository's harness doctor, manifest checks, or equivalent file-existence checks when available.
   - Report missing optional dependencies separately from blocking setup failures.
7. Local-only boundary gate
   - Never commit live `harness.config.json` unless the project explicitly treats it as public.
   - Keep `.docs/handoff/` out of tracked files.

## Workflow

1. Classify the setup request as `init`, `check`, `doctor`, `build`, or `localize`.
2. Inspect existing Claude Code and Codex adapter files before proposing changes.
3. Apply only idempotent setup edits or provide a clear manual diff when overwrite risk exists.
4. For `init` or `localize`, guide or create:
   - `AGENTS.md` from `assets/AGENTS.md.tmpl`
   - `.codex/config.toml` from `assets/codex-config.toml.tmpl`
5. Verify plugin manifests, skill directories, hooks/docs references, setup templates, and optional external tools.
6. End with the exact next command for the operator.

## Completion Contract

Report setup mode, files checked or changed, AGENTS.md / .codex/config.toml status, sandbox / approval / model / MCP / review-policy defaults, verification commands, optional warnings, next command, and local-only boundary status.
