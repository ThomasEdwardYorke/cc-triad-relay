---
name: context-audit
description: "Context budget audit skill (3-gate: size / dead-link / committed entry-point). Verifies that auto-loaded `.claude/rules/*.md` content stays under the configured `harness.config.json.contextBudget.budgetBytes`, every cross-reference resolves, and a committed root-level entry point (e.g. `CLAUDE.md` / `README.md`) advertises the on-demand rules directory. Use this when running a one-off check of context-budget health, before merging a PR that touches auto-load directories, or as a pre-merge gate. The Stop / PreToolUse hooks consume the same engine automatically when `contextBudget.enabled: true`."
description-ja: "コンテキスト予算 3-gate audit (size / dead-link / committed entry-point) skill。`harness.config.json.contextBudget.budgetBytes` に対して `.claude/rules/*.md` 合計サイズが上限内か / cross-reference が dead-link になっていないか / `CLAUDE.md` / `README.md` から on-demand rules dir への entry point が成立しているかを定量検証する。一回限りの health-check / auto-load dir 変更 PR の merge 前 / pre-merge gate として手動起動する。`contextBudget.enabled: true` 時は Stop / PreToolUse hook が同じ engine を自動消費するため、本 skill は補助的な手動起動経路 (debug / 手動再走行)。"
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
argument-hint: "[strict|quiet|config]"
---

# `/context-audit` — Context budget audit (3-gate)

> **TODO(Green phase)**: full skill body. This stub passes the existence
> tests written in `__tests__/context-audit-skill.test.ts`. The Green phase
> populates the rest while keeping the file ≤ 500 lines.

## Overview

Verifies the three invariants that keep auto-loaded context lean:

1. **Size budget**: `sum(autoLoadDirs/**/*.md byte length) ≤ budgetBytes`
2. **Dead-link reachability**: every cross-reference inside auto-loaded /
   on-demand directories points at an existing file
3. **Committed entry point**: a root-level committed file (default
   `CLAUDE.md` / `README.md`) references at least one `onDemandDirs/`
   path so a freshly-cloned developer can discover the on-demand rules

## Configuration

```json
{
  "contextBudget": {
    "enabled": true,
    "budgetBytes": 35000,
    "autoLoadDirs": [".claude/rules"],
    "onDemandDirs": ["docs/ai-rules"],
    "entryPointFiles": ["CLAUDE.md", "README.md"],
    "indexFile": ""
  }
}
```

`enabled: false` (default) keeps Stop / PreToolUse hooks idle. The skill
itself can still be invoked manually for diagnostics.

## How to invoke

```bash
/context-audit                      # default — uses harness.config.json
/context-audit --strict             # WARN treated as FAIL (CI gate)
/context-audit --config=<path>      # alt config (multi-tenant repos)
```

## Exit codes

| code | meaning |
|---|---|
| 0 | All 3 gates PASS |
| 1 | Size FAIL (over `budgetBytes`) |
| 2 | Dead-link FAIL |
| 4 | Entry-point FAIL |
| 3 / 5 / 6 / 7 | Bit-OR combinations of the above |

## Output format

```
── Auto-loaded rules size ──
  total: 32,963 bytes (budget: 35,000 bytes)
  PASS: under budget

── Dead link check ──
  PASS: no dead links

── Committed entry point reachability ──
  PASS: 1 root entry point references docs/ai-rules/ (CLAUDE.md)

═══ ALL PASS ═══
```

See [`docs/references/context-audit-details.md`](../../docs/references/context-audit-details.md)
for full details (signal definitions, sanitisation, generic-ising tips).
