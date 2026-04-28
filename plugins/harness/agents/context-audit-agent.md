---
name: context-audit-agent
description: "Read-only audit agent that runs the 3-gate context budget check (size / dead-link / committed entry-point) without mutating the project. Spawned by `/context-audit` and by hooks that need a fresh audit verdict. Returns a structured JSON report."
allowed-tools: ["Read", "Glob", "Grep", "Bash"]
---

# context-audit-agent

> **TODO(Green phase)**: agent body. This stub passes the existence test in
> `__tests__/context-audit-skill.test.ts`. Implementation lands in Green.

## Mission

Run the context-budget 3-gate audit without writing or editing anything in
the project. Return a JSON report so the parent skill / hook can render
human-readable output and decide whether to surface a warning.

## Constraints

- **Read-only**: no `Write` / `Edit` / `MultiEdit` allowed.
- **Generic**: never assume `.claude/rules` / `docs/ai-rules` literals — always
  consult the resolved `harness.config.json.contextBudget` config.
- **Fail-open**: any IO error degrades to a `skip` signal; the agent
  always returns a structured response.
