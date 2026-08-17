# Test Bed Usage Log

> **Maintainer-only record.** This file lives under `docs/maintainer/` (excluded from the public plugin surface). Every harness plugin feature derived from a test-bed project must be recorded here per `CONTRIBUTING.md` Section 5.

## Purpose

A test-bed project is used as a proving ground for new harness plugin features. This file records every experiment, the reusability judgment (R1/R2), and the extraction decision.

**Principle**: A test bed is a proving ground, not a specification. The plugin ships only what passes R1 and R2 (see CONTRIBUTING.md Section 5).

---

## Rules

- **Correct order (R-Flow)**: test-bed local → validate → reusability gate → port to plugin → record here → add generality tests → merge
- **Forbidden order**: plugin-first → verify in test-bed
- Never port project-local business logic to plugin core
- R1 and R2 must be evaluated and recorded for every portation
- Active self-hosting state belongs in ignored `.docs/handoff/**` and local `harness.config.json`, never in tracked maintainer docs


---

## Experiment Entry Template

```markdown
### YYYY-MM-DD — <feature name>

- **Test-bed repo**: <owner>/<repo>
- **Test-bed commit / branch**: <commit hash or branch>
- **Local-only implementation path**: `.claude/skills/<name>/` or `CLAUDE.md`
- **Hypothesis**: <what behavior was tested>
- **Observed benefit**: <what improved in the test bed>
- **Reusable invariant extracted**: <the generic mechanism, stripped of project nouns>
- **Project-local assumptions rejected**: <what was left out and why>
- **Config knobs introduced in plugin**: <new harness.config.json keys>
- **generality.test.ts assertions added**: <describe block and assertion text>
- **Decision**: `local-only` | `generalize-next` | `rejected`
- **Follow-up issue**: HARNESS-<N> or `none`
```

---

## Migration Log

Each item ported from test-bed to plugin:

| Date | Feature | Removed project-local values | Added config keys | Added test assertions | Release |
|---|---|---|---|---|---|
| 2026-04-22 | Generality guardrail + 119-leak cleanup | `feature/new-partslist`, `upper_script`, `create_script_from_*`, `protected-data/`, `全9ジャンル`, `script_generate`, `Phase N 申送 M-NN`, `Round N`, `A-N rM`, `CLAUDE.local.md`, `next-session-prompt.md`, `WeasyPrint`/`defusedxml`/`psycopg` mandated checklist, `Plans.md` hardcode in `pre-compact.ts`/`task-lifecycle.ts`, `担当表` hardcode in hooks, `PYTHONPATH=. pytest` universal default | `work.plansFile`, `work.assignmentSectionMarkers`, `work.handoffFiles`, `work.changeLogFile`, `security.projectChecklistPath`, `security.enabledChecks` | `generality.test.ts` 10 series (B-1..B-9), 941 assertions total; `content-integrity.test.ts` tracker-ID hygiene | v0.2.0 (2026-04-23) |
| 2026-04-22 (evening) | Phase γ — schema-aligned typed config surface | `work.maxParallel`/`.labelPriority`/`.criticalLabels`/`.testCommand`/`.qualityGates`/`.failFast`, `worktree.*`, `tddEnforce.*`, `codeRabbit.*` were schema-only and not surfaced in typed config | `WorkConfig` (6 new fields), `QualityGatesConfig`, `WorktreeConfig`, `TddEnforceConfig`, `CodeRabbitConfig`, union `WorktreeEnabledMode` / `PseudoCoderabbitProfile` | `config.test.ts` §Phase γ (10 assertions covering defaults + deep-merge of `work.qualityGates`) | v0.2.0 (2026-04-23) |
| 2026-04-22 (evening) | Phase δ — `tooling.pythonCandidateDirs` + `release.*` | Test-bed-specific hardcode array `["backend","src","app"]` in `subagent-stop.ts`; branch-name hardcode (`dev` / `main`) in release / branch-merge docs | `tooling.pythonCandidateDirs` (default `["src","app"]`, backend/ opt-in), `release.strategy`, `release.integrationBranch`, `release.productionBranch`, `release.testCommand` | `config.test.ts` §Phase δ (5 assertions); `hooks.test.ts` §detectAvailableChecks rewritten for stack-neutral default (9 tests); `content-integrity.test.ts` for worker.md + subagent-stop.ts new shape | v0.2.0 (2026-04-23) |
| 2026-04-22 (evening) | plugin.json / marketplace.json manifest explicit declaration | Implicit directory-discovery reliance; missing cross-marketplace dep | `plugin.json.commands[]` (12), `plugin.json.agents[]` (6), `plugin.json.hooks`; `marketplace.json.allowCrossMarketplaceDependenciesOn: ["openai-codex"]` | `content-integrity.test.ts` §plugin.json (4) + §marketplace.json (3) = 7 assertions | v0.2.0 (2026-04-23) |
| 2026-04-22 (evening) | Phase ζ — Codex companion opt-in + harness doctor overlay visibility | `install-project.sh` forced Codex install; `harness doctor` only reported Codex presence, not the rest of the overlay stack | Behavior change (`install-project.sh --with-codex` flag); `harness doctor` surfaces `harness.config.json` parse + `security.projectChecklistPath` resolution + `work.plansFile`/`handoffFiles` reachability + `.claude/skills/` presence + user-level `~/.claude/{skills,commands,agents}/` overlays | `content-integrity.test.ts` §install-project.sh (5) + §harness doctor (5) = 10 assertions | v0.2.0 (2026-04-23) |
| 2026-04-28 | Skill concurrent-invocation spec audit + stderr capture pattern (no plugin code change) | (no project-local removal) | (no new config keys; documentation-only entry + test-only addition) | `__tests__/config-strict-mode.test.ts` (8 assertions covering `resolvePythonCandidateDirs` parse-failed / shape-invalid / shell-meta-rejected / valid silent / absent silent paths via `process.stderr.write` direct monkey patch with full Writable.write signature preserved) | v0.4.0 |

**Skill concurrent-invocation audit (2026-04-28)** — Test-bed validation: confirmed against the Anthropic official spec (`https://code.claude.com/docs/en/skills`, `https://code.claude.com/docs/en/sdk`) that no `--parallel=N` / `concurrency` skill frontmatter or documented multi-Skill concurrent-invoke mechanism exists. Reusable invariant extracted: the `/parallel-worktree` N-parallel Agent-tool fan-out pattern (Markdown coordinator + `harness:worker` agents launched via `run_in_background=true`, tracked through `TaskCreate`/`TaskUpdate`/`TaskList`) is harness-internal orchestration that is *spec-compliant at the Agent-tool level* but *not surfaced through any official Skill-level concurrency declaration*. R1/R2 judgment: **local-only** for the documentation file itself (`docs/maintainer/skill-parallelism.md` is a maintainer-zone artifact and stays in the harness repo); the upstream proposal draft is captured for future submission to `https://github.com/anthropics/claude-code/issues`. No new `generality.test.ts` assertion is added because the change ships only documentation + tests (no consumer-facing API).

### 2026-05-12 — Historical Plans snapshot reconstruction

- **Test-bed repo**: predecessor `script_generate` checkout
- **R1/R2 judgment**: R1 — reusable invariant retained (maintainable baseline,
  branch safety, explicit review gates, and actionable maintainer cleanup are
  reusable; project-local predecessor work remains rejected).
- **Snapshot sources reviewed**:
  - `.docs/claude-code-harness-main/Plans.md`
  - `.docs/claude-code-harness-main 2/Plans.md`
  - repo-root `Plans.md`
- **Hypothesis**: The predecessor Plans files may contain still-useful harness invariants, but they must be triaged before any item enters the active cc-triad-relay backlog.
- **Observed benefit**: The review separated completed or project-local historical work from the current maintainer queue, preventing obsolete v3/v25/v26 tasks from being reintroduced as active work.
- **Reusable invariant extracted**:
  - Keep the TypeScript core, declarative guardrails, and tested plugin surface as the maintained baseline.
  - Keep branch safety as a repository invariant: normal work targets `dev` through short-lived feature branches; release PRs are the only route to `main`.
  - Keep CodeRabbit and Codex review gates explicit in implementation, merge, and release flows.
  - Keep Model B work measurable through dogfood evidence and release-readiness checks rather than by replaying old predecessor tasks.
- **Rejected historical items**:
  - v3 full rewrite task lists are historical; their durable parts already landed as the current TypeScript harness and tests.
  - Phase 25 solo-mode PM framework tasks are predecessor-planning history, not active cc-triad-relay backlog.
  - Phase 26 state-centered Project OS tasks are predecessor-planning history, not active cc-triad-relay backlog.
  - script_generate prompt-generation backlog is business-specific and stays in that project.
- **Retained actionable maintainer work**:
  - Verify branch protection and release PR gates before exposing `dev` to `main`.
  - Complete remote branch cleanup only after checking open PRs, branch heads, and unmerged work.
  - Run Model B dogfood and metrics work as the next roadmap stage after repository hygiene is complete.
- **Backlog handling**: Active task state remains in ignored `.docs/handoff/`; this tracked note records only sanitized triage evidence and durable maintainer decisions.
- **Project-local assumptions rejected**: predecessor branch names, script-generation prompt files, model/provider tuning decisions, and domain-specific validation commands.
- **Config knobs introduced in plugin**: none.
- **generality.test.ts assertions added**: none; `historical-handoff-reconstruction.test.ts` guards the maintainer-note contract and roadmap status note.
- **Decision**: `generalize-next`
- **Follow-up issue**: `none`

---

## Rejected Cases

Items that failed R1 or R2 and must stay project-local:

| Date | Feature | Reason | Stays where |
|---|---|---|---|
| 2026-04-22 | Predecessor `script_generate` runbook (`create_script_from_*`, `protected-data/`, `全9ジャンル` CSV checks) | Fails R1 (stack-specific business workflow); fails R2 (business logic that cannot be meaningfully generalized) | test-bed project's own `CLAUDE.md` / `.claude/skills/<project-name>-local-rules/references/review-runbook.md` |
| 2026-04-22 | Python Web stack security checklist (`WeasyPrint SSRF`, `defusedxml` XXE, Excel Zip Bomb, `psycopg.sql.Identifier`, CSRF signed double-submit) as mandatory | Fails R1 (stack-specific); fails R2 (library-coupled business logic) | test-bed project's `.claude/skills/<project-name>-local-rules/references/security-checklist.md` (to be created); plugin retains stack-neutral abstractions only |
| 2026-04-22 | `--test-pipeline` subflow with `protected-data/` CSV schema validation | Fails R1 (depends on predecessor project's data pipeline); fails R2 (business pipeline logic) | test-bed project's `scripts/check-pipeline.sh` + `.claude/skills/<project-name>-local-rules/references/pipeline-check.md` (deferred to Phase ε in next session) |

---

## Retrospective: Model B Evolution (2026-04-20 → 2026-04-22)

This is the first formal entry — a retrospective of the Model B evolution work that surfaced the need for this record.

- **Test-bed repo**: (the parts-management reference project used during Model B development)
- **Test-bed branch**: Phase 1 integration branch
- **Local-only implementation path**: test-bed repo's `.claude/rules/*.md` + gitignored `CLAUDE.local.md`
- **Hypothesis**: Harness can support both Model A (single Claude + Task subagent) and Model B (independent Claude per worktree) workflows, validated on a real development project
- **Observed benefit**: Model B enabled isolated TDD loops per feature worktree with tmux orchestration; PreCompact / SubagentStop / TaskCreated hooks reduced context loss at compaction boundaries
- **Reusable invariant extracted**:
  - Hook framework (PreCompact / SubagentStop / Stop / TaskCreated / TaskCompleted)
  - Guardrail rules R01-R13
  - Parallel worktree orchestration via `/parallel-worktree`
  - CodeRabbit integration (`/coderabbit-review` + `/pseudo-coderabbit-loop`)
  - TDD-enforced implementation loop (`/tdd-implement` v2)
  - Configurable `work.*` / `security.*` / `release.*` fields for project-local overrides
- **Project-local assumptions rejected**:
  - `feature/new-partslist` branch name (generalized to `feature/my-feature`)
  - `Plans.md` / `担当表` / `CLAUDE.local.md` / `.docs/next-session-prompt.md` hardcode (configuration-driven instead)
  - Python Web stack (`WeasyPrint`, `defusedxml`, `psycopg`) mandatory checklists (stack-neutral abstractions + project-local skill)
  - Predecessor script_generate project's business runbook (relocated to project-local)
- **Config knobs introduced in plugin** (this session):
  - `work.plansFile`, `work.assignmentSectionMarkers`, `work.handoffFiles`, `work.changeLogFile`
  - `security.projectChecklistPath`, `security.enabledChecks`
  - (Already existed: `work.testCommand`, `work.qualityGates`, `worktree.*`, `tddEnforce.*`, `codeRabbit.*`)
- **generality.test.ts assertions added**:
  - Series B-1 (specific branch names) × all shipped md/ts files
  - Series B-2 (predecessor API names) × all shipped md/ts files
  - Series B-3 (internal tracker IDs, 4 sub-series a/b/c/d) × shipped + test describes
  - Series B-4 (project-local required refs) × all shipped md/ts files
  - Series B-5 (stack-specific mandatory checklists) × agents
  - Series B-6 (Plans.md file-name hardcode in core)
  - Series B-7 (Japanese UI keyword hardcode in core hooks)
  - Series B-8 (absolute developer paths) × all shipped md/ts files
  - Series B-9 (Python stack commands as universal defaults)
- **Decision**: `generalize-next` — reusable parts ported, business-specific parts relocated to test-bed project-local
- **Follow-up issue**: HARNESS-generality-migration (track remaining Phase γ-ζ work)

---

## Open Follow-up Items

Recorded for future sessions (maintainer-only, not part of shipped plugin spec).

### ✅ Resolved in 2026-04-22 evening session

1. ~~Create actual `<test-bed>/.claude/skills/<project-name>-local-rules/` scaffold with references/~~ — **Done** (Phase ε, parts-management commit `c1383fe`). Scaffold contains `SKILL.md` + 3 references (`security-checklist.md`, `review-runbook.md`, `pipeline-check.md`). `.gitignore` updated on the test-bed to promote `.claude/skills/**` to tracked.
2. ~~Implement full CONFIG-IZE of deferred items (`worktree.*` wiring, `release.*` wiring, `tooling.pythonCandidateDirs`)~~ — **Done** (Phase γ/δ, plugin commits `5d22999` + `c17352d`). All schema fields are now surfaced via typed `HarnessConfig` with defensive narrow in consumers.
3. ~~Empty out `workMode.bypass*` semantics disagreement (Codex adversarial review M-6)~~ — **Done** (plugin commit `477397c`). schema / config.ts / tests were already aligned; the gap was docs. `harness-setup.md` now carries a dedicated subsection with the per-flag effect + non-effect (R10 / main protection intact).

### ✅ Resolved in 2026-04-22 "strongest harness" session (Phase κ + λ)

4. ~~Phase κ — `isolation: worktree` agent frontmatter~~ — **Done** (guard-test approach). 公式 docs 調査 `research-subagent-isolation-2026-04-22.md` で「`/parallel-worktree` が手動 worktree 管理しており worker 等に `isolation: worktree` を付けると二重 worktree 干渉リスク」を確認。全 6 agent に `isolation` を付けない現状方針を `content-integrity.test.ts` Phase κ guard で確定 (12 tests)。Phase κ-2 (`WorktreeCreate`/`WorktreeRemove` hook 協調設計 + isolation 付与) は Phase η と統合して Phase 2-3 スコープへ繰り越し。
5. ~~Phase λ — Remove `--test-pipeline` subflow~~ — **Done**. `harness-work.md` から `--test-pipeline` 関連 6 箇所 + `description` / `description-ja` frontmatter からも除去。`generality.test.ts` に B-2f guard pattern 追加で再導入を CI で blocking。歴史的記述 (v3/v2/v1) は経緯保持のため残置 + v4.2 changelog エントリ追記。Replacement は既に test-bed 側 `.claude/skills/<project>-local-rules/references/pipeline-check.md` で供用済。

### 🟡 Still open

6. English migration of shipped spec (Codex adversarial review C-3) — see `english-migration.md`. Phase 1 (new-file English-only rule) is now compliance-verified per the migration log; Phase 2 (critical-path migration of `harness-work.md` / `tdd-implement.md` / `parallel-worktree.md` / `worker.md` / `reviewer.md`) and Phase 3 (remaining files) remain deferred.

### 🆕 New follow-ups surfaced by the 2026-04-22 evening Codex Worker A + B official-docs audit

7. **Phase η — 17 unimplemented hook events.** Per `research-anthropic-official-2026-04-22.md` (Codex Worker A, Top 5 finding #1): harness handles 10 of 27 Claude Code hook events. Missing: `WorktreeCreate` / `WorktreeRemove` / `UserPromptSubmit` / `UserPromptExpansion` / `PostToolUseFailure` / `InstructionsLoaded` / `CwdChanged` / `FileChanged`, plus 9 others. `WorktreeCreate` is especially valuable as a workaround for open issue `anthropics/claude-code#28041` (`.claude/` not inherited by `--worktree`).
8. **Phase θ — `HookResult` field coverage.** Per Worker A Top 5 #2: `HookResult` only supports `decision` / `reason` / `systemMessage`. Spec supports 11 more fields (`continue`, `stopReason`, `suppressOutput`, `updatedPermissions`, `updatedInput`, `retry`, `watchPaths`, `worktreePath`, `updatedMCPToolOutput`, `action`, `content`). Breaking-change judgment required per field.
9. **Phase ι — `commands/` → `skills/` namespace migration.** Per Worker B Top 5 #1: shipping commands in `commands/*.md` puts them in the global namespace; migrating to `skills/<name>/SKILL.md` yields automatic `/harness:<name>` namespacing. Breaking change; needs explicit user sign-off before merging.
10. **Phase κ-2 — `isolation: worktree` + `WorktreeCreate`/`WorktreeRemove` hook 協調設計** — Phase κ (guard-test approach) の上位継続。`/parallel-worktree` との二重 worktree 干渉を解消するには hook 側で git worktree create/remove を interception する必要がある。詳細: `research-subagent-isolation-2026-04-22.md`。
