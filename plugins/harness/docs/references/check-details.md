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

## Output Template (実行結果の提示形式)

`check` 実行後の report 形式 (heading には bold を使い、`##` は避ける —
consumer document の regex-based scanner が誤検知しないため):

```markdown
**session-handoff check** — <YYYY-MM-DD HH:MM>

**Summary**
<PASS|WARN|FAIL|INIT_REQUIRED> — Structural: {P}/{W}/{F} | Content: {Extracted|Partial|Missing} | Synthesis: <Ready|Partial|Stale|N/A> | Context loaded: <N> lines (current: {X}, backlog: {Y})

**Context loaded**: Gate 2 で `Read` した `current + backlog` の行数合計。
300 行超は S-12 (current 90+) または S-13 (backlog 150+) のいずれかが既に
WARN 以上の状態を示唆 (分割検討)。report 要約外の詳細 (Quick-start bash 全文、
運用ルール、背景 docs 等) も **Claude context に ingest 済**なので、check 後の
再 Read は不要 (Anti-pattern #10)。

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
- **Backlog Top 3 [High]**: 1. ... / 2. ... / 3. ...

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
