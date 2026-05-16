---
name: context-audit
description: Audit Codex and Harness context sources for size, discoverability, dead links, and stale entrypoints.
---

# context-audit

Use this skill when the user asks Codex to inspect context health, always-on guidance, rules, handoff discoverability, or documentation entrypoints.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve repository root, branch, upstream, and dirty status.
   - Identify whether the audit is local-only, PR-bound, or release-bound.
2. Context source gate
   - Inventory durable guidance sources such as `AGENTS.md`, `.codex/config.toml`, `.claude/rules/`, handoff files, README files, and MCP-linked references.
   - Prefer committed entrypoints for public guidance and local-only paths for active session state.
3. Budget and discoverability gate
   - Flag oversized always-on context, dead links, duplicate instructions, and missing entrypoints.
   - Keep large references on-demand instead of forcing them into every session.
4. MCP gate
   - Treat MCP as optional external context.
   - Report unavailable MCP servers explicitly instead of assuming remote context was read.
5. Actionable report gate
   - Return prioritized fixes with concrete files and expected impact.
   - Do not edit context files unless the user explicitly requests an applied cleanup.
6. Local-only boundary gate
   - Do not move active handoff state into public docs.
   - Do not commit private MCP credentials, machine paths, or live session notes.

## Workflow

1. List the context sources that will be audited.
2. Check file size, duplicate guidance, references, committed entrypoints, and stale paths.
3. Compare Codex-specific guidance with Claude Code guidance only where both affect the same workflow.
4. Separate immediate fixes from future refactors.
5. End with a concise action list and any blocked remote context.

## Completion Contract

Report audited sources, high-priority issues, optional improvements, unavailable MCP/context sources, and local-only boundary status.
