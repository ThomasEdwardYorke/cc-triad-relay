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
3. Configuration template gate
   - Prefer generic templates and project-relative paths.
   - Keep `harness.config.json`, `AGENTS.md`, `.codex/config.toml`, and CodeRabbit guidance free of private machine paths.
4. Verification gate
   - Run the repository's harness doctor, manifest checks, or equivalent file-existence checks when available.
   - Report missing optional dependencies separately from blocking setup failures.
5. Local-only boundary gate
   - Never commit live `harness.config.json` unless the project explicitly treats it as public.
   - Keep `.docs/handoff/` out of tracked files.

## Workflow

1. Classify the setup request as `init`, `check`, `doctor`, `build`, or `localize`.
2. Inspect existing Claude Code and Codex adapter files before proposing changes.
3. Apply only idempotent setup edits or provide a clear manual diff when overwrite risk exists.
4. Verify plugin manifests, skill directories, hooks/docs references, and optional external tools.
5. End with the exact next command for the operator.

## Completion Contract

Report setup mode, files checked or changed, verification commands, optional warnings, next command, and local-only boundary status.
