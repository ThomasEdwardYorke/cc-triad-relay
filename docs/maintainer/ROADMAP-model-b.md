# cc-triad-relay: Model B 進化ロードマップ

> **Maintainer-only notes.** This file lives under `docs/maintainer/` and is **excluded from the public plugin surface**. It references the concrete test-bed project used during development. Public contributors and plugin consumers do not need to read this. See `CONTRIBUTING.md` Section 5 for the test-bed policy (test-bed project = proving ground, not specification). Reusable invariants extracted from the test-bed are documented separately in shipped specs under `plugins/harness/`.

**branch**: `feature/model-b-evolution`
**作成日**: 2026-04-20
**発端プロジェクト (test-bed)**: `parts-management` (maintainer-side reference only)
**関連 doc (test-bed side)**: `docs/harness-model-b-plan.md` (external, test-bed repo)

## Status as of 2026-05-12

This roadmap is historical plus forward-looking maintainer context. Do not start
new work from `feature/model-b-evolution`; normal work starts from `dev` on a
short-lived `feature/*` branch and merges back to `dev` before any release PR to
`main`.

Current state:

- Phase 0 and Phase 1 are complete in the shipped harness.
- Phase 2 infrastructure has landed as `/parallel-worktree-v2`, the tmux
  template, session manager, and `/claude-oneshot`.
- The active follow-up is Phase 3 dogfood and metrics, after repository hygiene
  tasks such as remote branch cleanup are settled.
- Historical predecessor Plans snapshots were triaged on 2026-05-12; see
  `docs/maintainer/test-bed-usage.md` for the retained and rejected items.

本 doc は cc-triad-relay plugin を Model A (coordinator + subagent) から
Model B (各 worktree で独立 claude プロセス + 同一ハーネス) へ進化させる
技術ロードマップ。**plugin 単体**の観点で必要な改修を記述。

---

## 背景

2026-04-20 時点で `parts-management` プロジェクトの Phase 1 実装中に、
本 plugin の v4.1 が以下の構造的矛盾を抱えていることが判明:

1. **`/parallel-worktree` が Model A を Model B として虚偽記載**
   - 仕様書: 「各 worktree で /tdd-implement v2 を完全実行」「各 worktree に同一 harness」
   - 実装: 単一 Claude セッション内で Task subagent を cd で動かすだけ

2. **`harness:worker` に品質ゲート実装が無い**
   - `disallowedTools: [Task]` + `Skill` tool 不在 → `/pseudo-coderabbit-loop` 呼出不可
   - 本文に TDD フロー具体記述なし、coordinator から渡されるプロンプト文字列依存

3. **`/tdd-implement` がプラグイン外 (user space) に孤立**
   - `~/.claude/commands/tdd-implement.md` に存在、plugin 配布不能

4. **`security-auditor.md` frontmatter 欠落** (tool 制約不機能)

5. **`harness.config.json` の spec 記述と実装 (`core/src/config.ts`) に乖離** (dead fields)

6. **全 6 agent `model: sonnet` 固定** (security-auditor は opus 向き、codex-sync は haiku で十分)

7. **未活用の Claude Code 機能** (subagent frontmatter `maxTurns`/`memory`/`isolation` [`isolation` は Phase κ の guard-test approach で現状方針 = 全 agent 未付与を regression guard 化完了。**Phase η P0-κ で `WorktreeRemove` の non-blocking observability 登録 + `WorktreeCreate` scaffold + regression guard まで完了。Phase κ-2 で `WorktreeCreate` の blocking protocol production 化完了: 実 `git worktree add` 実行 + raw stdout path + hooks.json 登録 + idempotent 検出 (`<parent>/<basename>-wt-<name>` sibling 規約、branch prefix `harness-wt/`)。agent 個別の `isolation: worktree` 付与は後続フェーズで対応予定 (`/parallel-worktree` 手動管理との二重 worktree 干渉防止のため、`WorktreeCreate` handler 側で既存 worktree を再利用する idempotency で対処済)。**]、hooks `SubagentStop`/`PreCompact`/`FileChanged`、MCP 0 個)

詳細は `parts-management/docs/harness-model-b-plan.md` 参照。

---

## ゴール

1. **Phase 0**: 現 Model A の虚偽記載 / dead code / frontmatter 欠落を解消し、Honest Model A を確立
2. **Phase 1**: 未活用の Claude Code 機能 (hooks / per-agent model routing / skill frontmatter 整備) を統合
3. **Phase 2**: Model B (各 worktree で独立 claude) をサポートする `/parallel-worktree v2` を実装
4. **Phase 3**: 実戦投入で Model A vs B の定量比較、v2 を main へ merge

---

## Phase 0: Honest Model A cleanup

### 対象ファイル

| # | ファイル | 修正内容 |
|---|---|---|
| P0.1 | `plugins/harness/commands/parallel-worktree.md` | Model A として正直に書き直す。「各 worktree に同一 harness」「Phase 5.5 は worker 内」の虚偽削除。Phase 5.5 以降は coordinator 責務と明示 |
| P0.2 | `plugins/harness/agents/worker.md` | Phase 5.5 呼出の嘘記述削除。TDD フロー具体を本文に追加 |
| P0.3 | `plugins/harness/agents/worker.md` / `reviewer.md` | stale コマンド参照 (`/work`, `/breezing`, `/fix-bug`, `/add-feature`, `/plan-with-agent`) を現行 (`/harness-work`, `/harness-review`) に更新 |
| P0.4 | `plugins/harness/agents/worker.md` / `reviewer.md` | テンプレート未置換 (`roles of worker and worker`) を修正 |
| P0.5 | `plugins/harness/agents/security-auditor.md` | frontmatter 追加 (name / description / tools / disallowedTools / model / color / maxTurns) |
| P0.6 | `plugins/harness/agents/*.md` | 全 6 agent に `maxTurns: 20-40` 追記 (worker: 40, coderabbit-mimic: 30, reviewer: 20, security-auditor: 30, codex-sync: 10, scaffolder: 20 目安) |
| P0.7 | `plugins/harness/commands/tdd-implement.md` (新規) | `~/.claude/commands/tdd-implement.md` を plugin 内に移動、`allowed-tools` / `argument-hint` 明示追加 |
| P0.8 | `plugins/harness/commands/harness-setup.md` | check サブコマンドのファイルリストに `tdd-implement.md` / `parallel-worktree.md` / `pseudo-coderabbit-loop.md` / `coderabbit-mimic.md` 追加 |
| P0.9 | `plugins/harness/commands/harness-review.md` | 旧 CodeRabbit 節削除、`/coderabbit-review` への参照に統一 |
| P0.10 | `plugins/harness/commands/harness-work.md` + `plugins/harness/schemas/harness.config.schema.json` + `plugins/harness/core/src/config.ts` | dead field 整合 (spec の `work.*`/`worktree.*`/`tddEnforce.*`/`codeRabbit.*` を core schema と合わせる or spec から削除) |
| P0.11 | `plugins/harness/commands/{tdd-implement,harness-work,parallel-worktree}.md` | Phase 番号体系を統一 (Phase 5.5 / 6 / 7 / 8 の意味を 3 文書で一致させる) |

### Phase 0 完了条件

- [x] **全 P0.1-11 が commit された** — v0.2.0〜v0.4.3 series で順次 landing。P0.5 (security-auditor frontmatter) / P0.6 (全 6 agent maxTurns) / P0.7 (`tdd-implement.md` plugin 内移動) は content-integrity で lock-in 済
- [x] **harness-setup check が全て緑** — `commands/harness-setup.md` の expected list が `tdd-implement` / `parallel-worktree` / `pseudo-coderabbit-loop` / `coderabbit-mimic` を含み、`content-integrity.test.ts` `harness-setup check の expected 配列` describe で固定
- [x] **Claude Code の smoke test (`claude --version` + `/harness-plan` 起動) が通る** — meta-session で `/session-handoff check` 実行 + agent invoke で empirical 検証済
- [x] **Codex 1 agent で差分レビュー (敵対的視点) が actionable 0** — gen-13 / gen-14 / gen-15 / gen-17 / gen-18 で Codex Phase 7 GO 連続観測、CodeRabbit `request_changes_workflow: true` effective 後は Real CR APPROVED state も auto-fire

---

## Phase 1: 未活用 Claude Code 機能の統合

### 対象

| # | ファイル | 修正内容 |
|---|---|---|
| P1.1 | `plugins/harness/core/src/hooks/pre-compact.ts` (新規) + `plugins/harness/hooks/hooks.json` | `PreCompact` hook で担当表 / 進行中 PR # / 現 Phase を `systemMessage` として注入 |
| P1.2 | `plugins/harness/core/src/hooks/subagent-stop.ts` (新規) + `hooks.json` | `SubagentStop` hook で ruff / mypy / pytest を自動実行 (CI safety net) |
| P1.3 | `plugins/harness/agents/security-auditor.md` | `model: opus` + skill 本文先頭に `ultrathink` プレフィックス **(done)** |
| P1.4 | `plugins/harness/agents/codex-sync.md` | `model: haiku` 試験 (軽量 wrapper のため) **(done)** |
| P1.5 | `plugins/harness/commands/*.md` | 全 skill に `allowed-tools` / `argument-hint` 明示 |
| P1.6 | `plugins/harness/core/src/hooks/task-lifecycle.ts` (新規) | `TaskCreated` / `TaskCompleted` で Plans.md 担当表を自動同期 (プロジェクトが Plans.md 運用を持つ場合のみ) |
| P1.7 | `plugins/harness/commands/session-handoff.md` (新規、2026-04-22 完了) | **Completed in PR #4 (`0fc8318`)**: 長期プロジェクトの引き継ぎ doc を 3 層構造 (current + backlog + design-decisions + archive/) で管理する skill。Anthropic 公式 [MEMORY.md][anthropic-memory] / [SKILL.md][anthropic-skills] pattern 準拠。subcommand: `init` / `update` / `archive` / `check`。汎用化厳守 (`<project>` placeholder、特定 project 情報なし)。**2026-04-22 follow-up**: `check` を 3-gate 化 (structural + content comprehension + rehydration synthesis)、orient-phase 把握/理解判定 (S-01〜S-12 + PASS/WARN/FAIL/INIT_REQUIRED)。**PR #6**: Gate 2 full-context ingestion 明示 + S-13 backlog 再肥大化 guard (150/200 行) + Anti-pattern #10 (check 後の再 Read 禁止) + Forbidden 3 カテゴリ圧縮 + Output Template Context loaded 表示 |

### Phase 1 完了条件

- [x] **`/compact` 後も担当表コンテキスト維持** — `core/src/hooks/pre-compact.ts` で `readAssignmentTable()` が Plans.md / 担当表を抽出し `additionalContext` として compaction を survive。`hooks.test.ts handlePreCompact` describe で coverage、`harness.config.json work.plansFile` / `work.assignmentSectionMarkers` で project-side 設定可能
- [x] **`harness:worker` 完了時に CI が自動実行** — `core/src/hooks/subagent-stop.ts` で worker / harness:worker 検出後 ruff / mypy / pytest / typecheck を `runCiCheck()` 経由で safety net 実行。`stop_hook_active` guard で infinite loop 防止 (gen-19、Anthropic spec 準拠)
- [x] **per-agent model routing が効く (security-auditor に opus、codex-sync に haiku)** — P1.3 / P1.4 実装済 (v4.1)。`model:` frontmatter が agent invocation に propagate することを content-integrity で lock-in 済
- [x] **session-handoff skill で長期プロジェクト引き継ぎをサポート (P1.7、2026-04-22)**
- [x] **Codex model registry (harness-dispatched Codex 呼出) の pin 機能** — `plugins/harness/core/src/models/resolver.ts` + `harness.config.schema.json` `models` section + `bin/harness model resolve|check` + codex-sync / codex-team / coderabbit-mimic に `--model` 注入 + `generality.test.ts` B-10 (model slug hardcode 検出)。shipped default は OpenAI 2026-04-24 リリースの GPT-5.5 に pin

[anthropic-memory]: https://code.claude.com/docs/en/memory
[anthropic-skills]: https://code.claude.com/docs/en/skills

---

## Phase 2: Model B infrastructure

### 対象

| # | ファイル | 修正内容 |
|---|---|---|
| P2.1 | `plugins/harness/commands/parallel-worktree.md` v2 | B-manual (tmux + `claude -n <slug>`) 前提に全面書き直し。Claude subagent 不使用、各 worktree で独立 Claude プロセスを起動する設計 |
| P2.2 | `plugins/harness/scripts/parallel-sessions-template.sh` (新規) | tmux session 管理スクリプトのテンプレート (プロジェクト個別にコピーして使う) |
| P2.3 | `plugins/harness/core/src/session-manager.ts` (新規) | 独立 claude プロセスの progress 監視 (git log + `/tmp/claude-log-*.jsonl` stream-json aggregator) |
| P2.4 | `plugins/harness/commands/claude-oneshot.md` (新規 skill) | `claude -p <instruction> --output-format stream-json` の wrapper skill |

### Phase 2 完了条件

- [ ] `bash scripts/parallel-sessions-template.sh start N <slugs>` で N worktree + N tmux window + N 独立 claude 起動
- [ ] 各 claude が同一 harness (skills / agents / rules / MCP) を使える
- [ ] coordinator から各 session の progress を監視可能
- [ ] 実プロジェクト (parts-management Week 5-6 CRUD) で動作検証済

---

## Phase 3: 実戦投入 + 定量評価 (詳細プラン)

> **着手前提**: Phase 2 全 Stage (B/C/D/E/F/G) が main に merge 済。Phase 0/1 は完了済 (gen-19)。
> **branch 戦略**: 現状 main に進行中 (`feature/model-b-evolution` ブランチは廃止 — gen-22 part 2 時点で main HEAD `d7ea190` まで進行)。Phase 3 は main から `docs/phase-3-results-*` / `feature/phase-3-pain-point-*` 系の short-lived branch で進める。

### P3.1 — Real-world pilot (parts-management Week 5-6 CRUD)

**目的**: Phase 2 で完成した Model B (parallel-worktree v2 + tmux template + session-manager + claude-oneshot) を実戦投入し、現実の multi-task 開発で痛み点を発見する。

**Scope** (test-bed = parts-management、4 sub-tasks 並列):
1. Project CRUD (POST/GET/PATCH/DELETE `/api/projects`、版管理 + 親子工事リネージ)
2. ProjectPart CRUD (枝番分岐 `derived_from_project_part_id` 込み、楽観ロック)
3. 場所マスタ CRUD (棟・エリア・棚)
4. 検索 API (pg_trgm GIN、全文検索 + 場所絞込)

**手順**:
1. parts-management 側 maintainer が `/parallel-worktree-v2 <spec.json>` を起動 (4 sub-task spec)。
2. 各 worktree で independent `claude -n <slug>` が立ち上がり、内部で `/tdd-implement` v2 を完全実行 (TDD Red→Green + Codex 並列検証 + Pseudo CR + Real CR + Codex Phase 7)。
3. coordinator は session-manager.ts dashboard で 4 sub-task の進捗を 1 view で監視。
4. 全 sub-task が Phase 8 (merge ready) に到達したら、coordinator が `/harness-merge-train` で sequential squash merge。
5. 完了後にメトリクス収集 (P3.2 へ)。

**完了条件**:
- [ ] 4 endpoint 全件 squash merged (`feature/new-partslist` 統合 branch に lands)
- [ ] Real CR Strong Clear (3 段判定: APPROVED state OR unresolved=0 / rate-limited marker 不在) 全件
- [ ] Codex Phase 7 SHIP 全件
- [ ] pytest coverage 80% 維持 (CI 強制)
- [ ] 4 sub-task 並列稼働中の wallclock を session-manager.ts ログから測定

### P3.2 — A/B 比較メトリクス収集

**比較対象**: Model A (v1 `/parallel-worktree`) vs Model B (v2 `/parallel-worktree-v2`)。

P3.1 を Model B で実施した結果を保存し、対照実験として **同じ 4 sub-task を Model A で fresh worktree から再実装** (or 既存 Model A のログを retrospective に集計)。新規実装が現実的でない場合、過去 sessions で実施済みの parallel-worktree v1 採用 PR (例: PR #X..#Y) を対照群として比較する。

**メトリクス**:
| 指標 | 測定 |
|---|---|
| **wallclock time** | PR open → squash merge までの median / max。`gh pr list --json closedAt,createdAt,number` 集計 |
| **API token cost** | Anthropic dashboard (per-session) + Codex usage log の per-task 集計 |
| **quality: Real CR rounds** | Real CR 各 PR の総 review round 数 (`gh pr view --json reviews` で comments 数えで近似) |
| **quality: Codex Phase 7 FIX_FIRST** | Phase 7 で SHIP に至るまでの round 数 |
| **quality: post-merge hot-fix** | merge 後 1 週間以内に同 endpoint へ patch PR が出た件数 |
| **operator load** | human intervention (review reply / merge trigger / conflict resolution) の回数 |

**集計 tooling**:
- `bin/harness phase-3-metrics --pr-range <from>..<to>` のような CLI を新設して標準化 (Phase 3 期間中に実装)
- 中間出力: JSON (`docs/maintainer/phase-3-metrics.json`)、最終 report は markdown
- 実装済み CLI: 公開 surface では汎用名 `bin/harness pr-metrics --pr-range <from>..<to> [--repo owner/name]` として提供する。
  - `gh pr view` から PR open → merge/close wallclock、CodeRabbit review / change-request / approval 数を集計する。
  - Phase 3 運用では `--output-json docs/maintainer/phase-3-metrics.json` / `--output-md docs/maintainer/phase-3-results-<YYYY-MM-DD>.md` を明示する。
  - API token cost / Codex Phase 7 FIX_FIRST rounds / post-merge hot-fix / operator load は GitHub metadata から導出できないため、JSON/Markdown の manual metrics 欄に `TBD` として残す。

**成果物**: `docs/maintainer/phase-3-results-<YYYY-MM-DD>.md` (期間: P3.1 完了から 1 週間後)

### P3.3 — B-manual 痛み点改善 (反復、優先度順)

P3.1 で発見した痛み点をカテゴリ別に対処。期待される候補と着手優先度:

| 優先度 | 痛み点 | 改善案 |
|---|---|---|
| High | session 長時間 silent (claude が hung、log 更新なし) | session-manager.ts に `last-event-timestamp > 10min` の WARN、`> 30min` の FAIL を追加。tmux pane name を `<slug>-IDLE-<min>` に動的更新 |
| High | 4 worktree 間の dynamic conflict (同 file 編集を merge train で発見) | `detectOverlap()` の動的版を `harness-merge-train` 内に組込: 各 PR squash 直前に `git merge-base` 比較で残 PR との overlap 再評価 |
| Med | crash 時 rollback 手順不明 | `parallel-sessions-template.sh stop --rollback` で worktree 削除 + branch 削除 + tmux session kill を 1 command に統合 |
| Med | tmux 学習コスト (operator が tmux 不慣れ) | `docs/operator/tmux-quickref.md` 新設 (10 行 cheatsheet)。`/parallel-worktree-v2 attach <slug>` で session-manager.ts 内に inline help 表示 |
| Low | session-manager dashboard refresh が手動 | `bin/harness session-manager watch` で auto-refresh (Monitor tool 経由 or `watch -n 5`) |

各痛み点は個別 PR として main に merge する (1 痛み点 = 1 PR)。

### P3.4 — Phase 3 完了 + v0.5.0 release

P3.1-P3.3 完了後、Phase 2/3 累計成果を含めて `v0.5.0` release。

**release checklist**:
- [ ] CHANGELOG.md に Phase 2 (B/C/D/E/F/G) + Phase 3 (P3.1 results / P3.3 改善) の bullets 追加
- [ ] `plugins/harness/.claude-plugin/plugin.json` version `0.4.0-rc.1` → `0.5.0`
- [ ] `.claude-plugin/marketplace.json` 同
- [ ] `package.json` workspace versions 同
- [ ] `git tag v0.5.0` + push
- [ ] GitHub Release: P3.2 比較データ + P3.3 改善 highlights を notes に
- [ ] upstream consumer (parts-management) の harness.config.json で Model B が default workflow になる

### Phase 3 完了条件

- [ ] P3.1 4 endpoint 全件 main merged + Strong Clear + Codex SHIP
- [ ] P3.2 比較メトリクス出力 (`docs/maintainer/phase-3-results-<YYYY-MM-DD>.md`)
- [ ] P3.3 痛み点 High 優先度 2 件解消
- [ ] P3.4 v0.5.0 tag + Release published
- [ ] upstream consumers (≥ 1) で Model B default 採用済

### P3.5 — `/harness-work` v6: Auto Mode Detection に Model B 経路を追加 (2026-05-03)

**着手 / 完了** (Phase A-2 dogfood、cc-triad-relay shipped 改修):

| # | ファイル | 修正内容 |
|---|---|---|
| P3.5.1 | `plugins/harness/commands/harness-work.md` | v6 spec: 新 flag `--parallel-mode=v1\|v2` (default `v1` 互換) + Auto rule (`work.allowAutoModelB: true` opt-in 下で `n_tasks >= 2 && recent_subagent_failures >= 2` で v2 降格、`n_tasks >= 3` で v2 default) + Step 4.2 委譲表に `/parallel-worktree-v2` (Model B) 行追加 |
| P3.5.2 | `plugins/harness/core/src/work/parallel-mode-resolver.ts` (新規) | precedence chain (cli → auto rule → harness config default → fallback `v1`) を純粋関数で実装 |
| P3.5.3 | `plugins/harness/core/src/__tests__/generality.test.ts` | Pattern B-3h 追加 (`\bD-\d+\b` numeric backlog tracker ID forcing function、shipped surface での leak 防止) |
| P3.5.4 | `plugins/harness/agents/worker.md` + `plugins/harness/agents/codex-sync.md` | Late-finalization safeguard (status-marker first) を対称追加 — Round 9 / Phase 7 dogfood で観測された「intent 文を最後に emit してから interrupt される subagent failure」への構造的対症療法。worker は `STATUS:` を最初に emit、codex-sync は marker (`PATCH_APPLIED` / `FINDINGS_ONLY`) を finalization frame に入った瞬間 emit して supplementary narrative を後付けしない |
| P3.5.5 | `plugins/harness/core/src/__tests__/harness-work-v6-parallel-mode.test.ts` (新規) + `pwt-p0-improvements.test.ts` 拡張 | content test で v6 spec / safeguard を CI 固定 |

**完了条件**:
- [x] commands/harness-work.md v6 spec 拡張 (Auto Mode に Model B 経路 + `--parallel-mode=v1\|v2`)
- [x] core/src/work/ flag parser (`parallel-mode-resolver.ts`) 追加
- [x] generality.test.ts Pattern B-3h 追加
- [ ] parts-management 本流 dogfood (cc-triad-relay 側 PR merge 後、consumer 側で auto rule opt-in 検証)
- [x] ROADMAP Phase 3 整合 (本 entry P3.5)
- [x] worker / codex-sync 対称 fix (Round 9 / Phase 7 dogfood の subagent failure に対する Late-finalization safeguard)

---

## 重要な設計判断

### なぜ `claude --worktree` を使わないか

Claude Code 2.1.49 の公式 `claude --worktree` は `<repo>/.claude/worktrees/<name>` に worktree を作るが、`.claude/skills` / `agents` / `rules` が worktree に**非継承**というバグ ([issue #28041](https://github.com/anthropics/claude-code/issues/28041)) がある (2026-04-20 未解決)。これは Model B の「各 worktree で同一ハーネス」要件と正面衝突。

**回避**: sibling worktree (`../<project>-wt-<slug>`) を `git worktree add` で作成。sibling はユーザー level `~/.claude/` (harness plugin / user agents / user commands) を共有できる。プロジェクト level `.claude/` は sibling 側で初期化されるが、その空きを利用してプロジェクト個別の overlay を載せる構造を設計する。

### なぜ subagent に `Task` tool を戻さないか

[issue #19077](https://github.com/anthropics/claude-code/issues/19077): subagent に `Task` を許可すると sub-sub-agent 起動で OOM が報告されている。現 `disallowedTools: [Task]` は安全上妥当。

**Model B の意義**: nesting 問題そのものを回避。各 worktree の独立 claude プロセスはそれぞれが top-level、各々が Task tool で subagent を起動できる (single-level nesting、OOM リスクなし)。

---

## 運用ルール

### branch 切替時

harness plugin は single working tree のため、branch 切替すると全 active Claude session に影響する。したがって:

- Phase 0-3 作業は**全ての他 active Claude session を一時停止してから** `feature/model-b-evolution` に切替
- 作業完了後は `main` に戻し、smoke test OK を確認してから他 session 再開
- 長時間作業中は全 session を閉じた状態で実施

### commit 粒度

- 1 commit = 1 Phase task (P0.1 / P0.2 / P1.1 ...)
- commit message 先頭に `[P0.1]` 等の task ID 明示
- `feature/model-b-evolution` にのみ push、main に直 commit しない

### rollback

作業中にハーネスが壊れた場合:

```bash
cd ~/.claude/plugins/marketplaces/cc-triad-relay
git checkout main  # v4.1 動作確認済 main に戻る
# 他 session 再開 OK
```

---

## 関連 resources

- Claude Code 公式 docs: `https://code.claude.com/docs/en`
  - SKILL.md focused 原則 + supporting files: `https://code.claude.com/docs/en/skills`
  - **MEMORY.md 200 行 / 25KB hard budget** (auto memory): `https://code.claude.com/docs/en/memory` — consumer-side で SessionStart hook 経由 `current.md` を auto-load する設計を採用する場合、本 budget が hard ceiling になる
  - SessionStart / SessionEnd / PreCompact hook + source 区別 (`startup` / `resume` / `clear` / `compact`): `https://code.claude.com/docs/en/hooks-guide`
- Open issues:
  - `anthropics/claude-code#28041`: `.claude/` 非継承 in `--worktree`
  - `anthropics/claude-code#19077`: nested subagent OOM
- OSS 実装例:
  - [workmux](https://github.com/raine/workmux)
  - [Codeman](https://github.com/Ark0N/Codeman)

### Test-bed references (parts-management、maintainer only)

下記 doc は test-bed (`parts-management`) で発生した実装メモ。public plugin surface 外。

- `docs/harness-model-b-plan.md` (committed、プロジェクト側プラン)
- `.docs/harness-analysis-2026-04-20.md` (local、現状診断)
- `.docs/harness-model-b-session-prompt.md` (local、セッション起動手順)

---

**次アクション**: Phase 0.1 (`commands/parallel-worktree.md` を honest Model A として書き直す) から開始。`parts-management/.docs/harness-model-b-session-prompt.md` のステップ 2-1 に従ってセッション起動。
