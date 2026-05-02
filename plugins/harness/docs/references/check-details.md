# `check` subcommand details (Output Template + Forbidden + Edge Cases)

> Companion to `commands/session-handoff.md` § `check` subcommand. The
> spec body keeps only the Gate 1-3 + 4 (handoff mode) signal table and
> high-level Post-Check Verification summary. **The full Output Template,
> the Forbidden ops list, and the degraded-mode Edge Cases live here** so
> the spec stays under the Anthropic SKILL.md focused-pattern limit
> (≤ 500 lines).

This document is **not** a slash command — it is reference material
imported on demand by humans / agents reviewing or implementing
`check`.

---

## Output Template (default = concise, opt-in verbose via `--verbose`)

v2.1 で `check` の出力 template は **2 種** に分割した:
**concise (default)** と **verbose (`--verbose` 明示 or WARN/FAIL auto-promote)**。
default では PASS verdict を 5 行 summary に圧縮し、tool 結果文字列の context
肥大を削減 (-50% 〜 -60% target、§ Token reduction baseline 参照)。

heading には bold を使い、`##` は避ける —
consumer document の regex-based scanner が誤検知しないため。

### Output Template (concise default)

PASS verdict 時の **5 行 summary** (session-handoff.md spec の固定 5 項目と一致):

```markdown
**session-handoff check** — <YYYY-MM-DD HH:MM> — PASS
Branch: <branch> | Commit: <hash> <msg> (<date>)
Top priority: <extracted one-liner>
Context loaded: <N> lines (current: {X}, backlog: {Y}, mode: concise)
Next: <recommended action; "ready to start next task" if nothing pending>
```

5 行 summary 設計意図:
- **行 1**: timestamp + verdict (`PASS` 限定、WARN/FAIL は auto-promote で verbose 経路)
- **行 2**: branch + latest commit (S-02/S-03/S-05 突合済の事実)
- **行 3**: Top priority one-liner (current.md から抽出した即着手タスク)
- **行 4**: Context loaded metadata (再肥大化検知、`mode: concise|verbose` で ingest mode 開示)
- **行 5**: Next 推奨アクション (PASS なら "ready"、軽微 INFO ありなら 1 行で示唆)

backlog Top 3 IDs は **partial ingest 時の Bash grep 結果** として Claude context
内に保持される (verdict 判定材料)。concise summary には混入させず、必要なら
`--verbose` で verbose template (Backlog Top 3 を Gate 2 表に明示) に切替。

### Output Template (verbose)

`--verbose` 明示指定 / WARN・FAIL auto-promote 時の **詳細 template**:

```markdown
**session-handoff check** — <YYYY-MM-DD HH:MM>

**Summary**
<PASS|WARN|FAIL|INIT_REQUIRED> — Structural: {P}/{W}/{F} | Content: {Extracted|Partial|Missing} | Synthesis: <Ready|Partial|Stale|N/A> | Context loaded: <N> lines (current: {X}, backlog: {Y}, mode: verbose)

**Context loaded**: Gate 2 で `Read` した `current + backlog` の行数合計。
300 行超は S-12 (current 90+) または S-13 (backlog 150+) のいずれかが既に
WARN 以上の状態を示唆 (分割検討)。verbose mode では report 要約外の詳細 (Quick-start
bash 全文、運用ルール、背景 docs 等) も **Claude context に ingest 済**なので、
check 後の再 Read は不要 (Anti-pattern #10、verbose 路は current/backlog 共に full
ingest なので個別 Read 圏外)。

**INIT_REQUIRED**: `.docs/handoff/` が空/未作成時の独立 verdict。他 3 verdict と
orthogonal、Structural/Content/Synthesis 実行前に判定、`init` 案内を表示。

---

**Gate 1 — Structural Integrity**

| 項目 | 結果 | 詳細 |
| --- | --- | --- |
| current.md 行数 | ✅ N 行 / 120 上限 | — |
| detail files 存在 | ✅ 全 N 件 (必須 2 件 + optional M 件) | — |
| backlog ラベル | ⚠️ M 件ラベルなし | 行 X, Y |
| design-decisions append-only | ✅ | — |
| archive 命名規約 | ✅ 全 N 件 | — |

---

**Gate 2 — Content Comprehension**

- **Branch**: <branch>
- **Latest commit**: <hash> <msg> (<date>)
- **Top priority**: <extracted one-liner>
- **Quick-start command**: ✅ / ⚠️ missing
- **Pointers**: N 件 (全て実在確認済 / N 件 broken)
- **Backlog Top 3 [Critical|High]**: 1. ... / 2. ... / 3. ...

---

**Gate 3 — Understanding Synthesis**

- **Rehydration verdict**: <Ready|Partial|Stale>
- **Staleness signals**:
  - ⚠️ S-01: current.md が N 日更新なし (<date>)
  - ✅ S-02 / S-03 / S-05 (git 突合 OK)
  - (他 signals を列挙)
- **Gate 4 — Roadmap Freshness** (handoff mode のみ、Plans-mode では省略): Mode / Roadmap path / S-14〜S-17 を列挙。

---

**Recommended Remediation**
<FAIL があれば具体的な次アクション、PASS なら「次タスクに着手可能」の一言>
```

### Mode selection (どちらの template を emit するか)

| trigger | mode | rationale |
| --- | --- | --- |
| 引数なし + verdict = PASS | **concise** (default) | 通常 happy-path、context 削減を最大化 |
| 引数なし + verdict = WARN/FAIL | **verbose** (auto-promote) | 診断情報が必要、failsafe な可観測性 |
| `/session-handoff check --verbose` | **verbose** (明示) | operator が詳細を欲しい時の opt-in 経路 |
| 引数なし + verdict = INIT_REQUIRED | **concise** (init 案内のみ 1-2 行) | template 適用前段、`init` 一語で済む |

backlog ingest mode (partial / full) と Output Template (concise / verbose) は
**同期して切替** される (`--verbose` も auto-promote も、両方を verbose 側に倒す)。

---

## Gate 2 partial-ingest 詳細手順 (concise mode 補助)

session-handoff.md `### check` Gate 2 の concise mode 詳細手順 (taskTrackerMode
両対応):

1. **`wc -l <backlog>` で Y_total** (S-13 用):
   - `wc` 失敗 → `Y_total = N/A` で fallback `Glob` (file 行数推定)
   - `Glob` でも取得不能なら **S-13 を SKIP** (output に明示)
2. **`grep -nE '^###|^##|^- \[(Critical|High|Med|Low)\]' <backlog>`** で heading
   + plans-mode list item を 1 発抽出 (~13 件目安):
   - **handoff-mode**: `### [Critical|High|Med|Low] <id> <title>` heading が拾われる
   - **plans-mode**: `- [High|Med|Low] <Phase>: <description>` 1-line list item が拾われる
3. **`grep -nE '#[0-9]+|/pull/[0-9]+|pr:\s*[0-9]+|PR\s*#[0-9]+' <backlog>`** で
   全 backlog 範囲の PR 参照を抽出 (S-04 用、Bash report 経由で参照、Read で
   context に入れない設計 → partial mode でも S-04 圏外 silent miss を防ぐ)
4. **Top top-3 entry 追加 ingest** (各 5-8 行 × 3 = ~20 行):
   - **handoff-mode**: `Read` (offset/limit) で `### [Critical|High]` heading 直下の
     fenced YAML block を ingest (`id` / `priority` / `status` / `roadmap_ref` 等)
   - **plans-mode**: 前段 grep の `- [High|Med]` 上位 3 行を Bash 結果からそのまま
     採用 (1 line/entry なので追加 Read 不要、Bash 結果が要約として機能)
5. 合計 Y_partial ≈ heading + top-3 詳細 + metadata = **~40 行 envelope**

mode=verbose (--verbose 明示 / 後段 auto-promote) は上記を全て skip し `Read` で
`backlog.md` 全文 ingest (Y_full = Y_total、taskTrackerMode 不問)。

---

## Token reduction baseline (v2.1 measurement methodology)

v2.1 は (a) backlog partial ingest +
(b) concise default output で **PASS path に対し -60% stretch target / 観測値
-45% 〜 -53%** の context 圧迫削減を目指す (handoff サイズ依存、下記 Reduction
表参照)。実 token 測定の baseline / methodology を以下に開示する。

### Baseline (v2.0、full ingest + verbose template only)

代表 consumer handoff 2 件で測定 (PASS path、v2.1 着手前の sample):

| handoff | current.md | backlog.md | output template (verbose) | 合計 (≈ token) |
| --- | --- | --- | --- | --- |
| handoff #1 | 77 行 | 147 行 | ~35 行 | ~259 行 (~1.8K token) |
| handoff #2 | 97 行 | 126 行 | ~35 行 | ~258 行 (~1.8K token) |

平均 ~258 行 / ~1800 token 相当 (1 行 ≈ 7 token、tool result wrapping 別途)。
これに加えて `session-handoff.md` spec body の自己参照 read と reference docs
(`check-details.md` 等) で実体感としては **10K token 弱** が `check` 1 回で消費される
(200K context window の **~5%** 相当)。

### v2.1 (partial ingest + concise default)

| handoff | current.md (full) | backlog.md (partial ~40 行) | output template (concise 5 行) | 合計 (≈ token) |
| --- | --- | --- | --- | --- |
| handoff #1 | 77 行 | ~40 行 | ~5 行 | ~122 行 (~0.85K token) |
| handoff #2 | 97 行 | ~40 行 | ~5 行 | ~142 行 (~1.0K token) |

### Reduction (PASS path)

- **(a) ingest 削減**: backlog 147→40 行 = **-73% (per file)** / 全 ingest 224→117 行 = **-48%**
  (handoff #1 ベース、current.md は変えていない)
- **(b) output 削減**: 35→5 行 = **-86%**
- **PASS 合算**: 259→122 行 = **-53% (handoff #1)** / 258→142 行 = **-45% (handoff #2)**

current.md が大きい handoff #2 では (a) の効果が薄まり -45% に留まる。**観測値は
-45% 〜 -53% で -60% target には届かない**。 -60% を上振れさせるには current.md
側 slim 化 (90 行以下、S-12 WARN 圏外) を併用する必要あり (Post-Check Verification
経路で operator が判断)。**-60% は upper-bound stretch target と位置付け**、
default-applicable な保守的削減目標は **-45%** とする。verbose 昇格時 (WARN/FAIL
auto-promote) は v2.0 と同等の token 消費に戻り、概ね **PASS path 専用の最適化**
として適用される。

### 適用範囲 (どの verdict でどの template / ingest を使うか)

- **PASS** → concise output + partial ingest = **削減フル適用**
- **WARN** → verbose output + full ingest (auto-promote) = **v2.0 同等**
- **FAIL** → verbose output + full ingest (auto-promote) = **v2.0 同等**
- **INIT_REQUIRED** → 1-2 行 init 案内のみ = **削減フル適用 (template 自体不適用)**

PASS が圧倒的多数 (handoff 健全運用時) のため、運用平均では **概ね -50% 〜 -55% の
token 削減** が見込める。-60% への上振れには current.md 側 slim 化 (90 行以下に保つ)
が併走条件。

---

## Forbidden (check の禁止事項)

`check` は **read-only must**。絶対禁止:

- **write op 全般**: ファイル書き換え / 削除、`git commit` / `push` / `reset`、
  `design-decisions.md` 編集 (append-only 守護)、archive 削除 / 移動、
  上位 memory (project / user) 書き換え、PR / Issue 自動 close
- **ネットワーク書込**: 外部 POST (read-only `gh pr view` のみ許可)
- **推測 stale 断定**: git / Glob 実証不可なら「確認不可」で WARN 止まり

---

## Edge Cases (劣化ケースのハンドリング)

- **First-time use (未初期化)**: `Glob` で `.docs/handoff/` が空なら `FAIL`
  ではなく `INIT_REQUIRED` を返し、`/session-handoff init` の実行を案内。
- **Git unavailable (CI / shallow clone)**: `Bash: git ...` が exit ≠ 0 なら
  以下全てを SKIP し、output に "git unavailable — skipped: S-02, S-03,
  S-05, S-08, S-11, design-decisions append-only 判定" と記載:
  - Gate 3 の git 依存 signal (S-02 / S-03 / S-05 / S-08 / S-11)
  - Gate 1 の `design-decisions.md` append-only 判定 (`git diff` 依存、
    git 不可環境では非決定的なため WARN `append_only_unverified` に格下げ)

  Structural (git 非依存分) と Content は継続実行 (hard fail しない)。
- **Large archive (> 20 files)**: 主規約 (`session-<YYYY-MM-DD>-*.md`) のみ
  日付ソートで最新 10 件を命名規約チェック。命名例外 (`summary-*.md` /
  `pre-*.md`) は件数カウントのみ (日付情報なし)。output に「session
  archives: N 件中最新 10 件サンプリング、exception archives: M 件」と明記。
- **gh CLI 未導入**: S-04 を SKIP (他 signal は継続)。
- **current.md の markdown 破損** (canonical behavior): Required section が
  regex で拾えないなら以下を統一的に実施:
  1. Gate 2 (Content Comprehension) を **即時停止** (部分抽出した情報は破棄)
  2. Gate 3 (Synthesis) を引き続き実行。ただし Gate 3 の staleness signal
     走査は Gate 2 抽出情報に依存する S-04 / S-05 を SKIP
     (`content_comprehension halted: signals skipped: S-04, S-05`)
  3. Output Template では `required_section_missing: FAIL` を Gate 1
     Structural 結果として carry-over 表示し、Gate 2 / Gate 3 は degraded
     status で報告
  4. Recommended Remediation で「current.md の required 4 sections を修復
     し再実行」を必ず提示

  (Gate 3 完全 skip ではなく「Gate 2 dependent signals だけ skip」とする
  理由: Structural (Gate 1) 由来のシグナル S-06 / S-07 / S-09 / S-10 / S-12
  / S-13 は Gate 2 に依存しないため、引き続き有用な陳腐化診断を提供できる)

---

## Related (related)

- `commands/session-handoff.md` § `check` subcommand (3-gate / 4-gate 本文)
- `docs/references/post-check-verification.md` (Test 1-5 manual checklist、
  `check` PASS でも anti-pattern #4 を犯していないか手動 verify)
- `docs/references/final-report-format.md` (`archive` で emit する 8 section
  最終報告のうち Section 6 が本 Output Template の Test 1-5 結果を含める)

---

**version**: v1.0 — 2026-04-27 initial split from
`commands/session-handoff.md` (spec body を ≤ 500 行に維持するための
detail offload)
