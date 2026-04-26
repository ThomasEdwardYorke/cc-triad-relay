# Final Report Format (8 sections, fixed layout)

> Companion to `commands/session-handoff.md` — invoked by the `archive`
> subcommand's "最終報告 emit step". Use this template every time a session
> ends so the user can grasp the whole session in a single read.

## Why this template exists

Running `harness:session-handoff archive` is mechanical bookkeeping.
The **final report** is what the user actually consumes after the agent
hands control back. Without a fixed layout the agent emits ad-hoc
summaries that miss critical sections (e.g. retrospective, gate ledger,
handoff health) and force the user to ask follow-up questions like
「完璧ですか?」.

A consumer that wants project-specific augmentation should keep a memory
named `reference_session_final_report_template.md` (consumer-side; recall
this name verbatim — it's how `archive` discovers project extensions).
Plugin-side keeps the **generic backbone** here.

## Emit conditions (must follow)

- Emit **only after** `Skill({skill: "harness:session-handoff", args: "archive"})`
  has finished. **`update` 単独では emit しない** — `update` は `current.md` 最新化のみで、
  最終報告は session 終了時の `archive` ターンに紐付ける設計。Stop hook reminder で
  `update` を促されても、その turn では 8 section emit を省略してよい。
- Emit **all 8 sections**, even if a section is "該当なし / N/A".
- Self-verify Section 6 (Post-Check Verification, Test 1-5) inside the
  report; the user does not need to re-ask 「完璧ですか?」.

## Layout (8 sections, fixed order)

The fenced block below uses 4-backtick fences so inner ` ``` ` blocks
(bash / markdown samples) do not break the outer template.

````markdown
# 📋 Session 終了報告 — <session-id> (<YYYY-MM-DD>)

## 1. このセッションで行なった開発

- **主要成果** (3 bullet 以内、各 1 行):
  - ...
- **PRs / Commits**:
  - <repo>#<NN> (`<feature-branch>` → `<base-branch>`、squash merged at `<sha>`)
  - <その他 commits>
- **変更 file** (簡易 table、+/- 概数):

  | File | +/- | 概要 |
  |---|---|---|
  | ... | +<N>/-<M> | ... |

## 2. 開発状況サマリ

| 指標 | 値 |
|---|---|
| 本 session タスク達成 | <N>/<M> (<X>%) |
| 該当 Phase 全体進捗 | <X>% (前回比 +<Y>%) |
| 累計 PRs merged (本 stream) | <NN> (本 session: <M>) |
| Test count | <NNNN> passing |
| handoff state | current <N>行 / backlog <N>行 / archive <KB>KB |

## 3. 次セッションのスコープ (即着手項目)

**Top Priority** (5 行以内、具体 command + 対象 file 必須):

- **[Critical]** ...
- **[High]** ...
- **[Med]** ...

**Quick-start command** (copy-paste 可):

```bash
cd <project-root>
/session-handoff check
# ...具体コマンド
```

## 4. 残タスク 一覧 (priority sorted)

| # | priority | item | progress | source |
|---|---|---|---|---|
| 1 | Critical | ... | 0% / <N>% / done | backlog L<line> |
| 2 | High | ... | ... | ... |
| 3 | Med | ... | ... | ... |

**Carry-over (未着手 + ID 付き)**: <一覧 or 該当なし>
**完了 (本 session で resolved)**: <一覧>

## 5. 振り返り (retrospective)

**Good (続けるべき、本 session で機能した行動)**:
- ...

**Improve (改善点、本 session の failure mode)**:
- ...

**Learnings (次に活かす知見、empirical 観測 / 設計判断)**:
- ...

## 6. チェックリスト 確認 (Post-Check Verification 含む)

| Phase | 計画 | 実績 | 備考 |
|---|---|---|---|
| Phase 0-N | ✅/❌ | ... | ... |

**Post-Check Verification (Test 1-5)** [本 session の current.md 自己検証]:

- Test 1 (Latest state 具体性): ✅/⚠️/❌ — <根拠>
- Test 2 (Top Priority 即着手性): ✅/⚠️/❌ — <根拠>
- Test 3 (確立 invariant 1 行 takeaway): ✅/⚠️/❌ — <根拠 or N/A (`<decision-id>` 体系なし時)>
- Test 4 (Quick-start copy-paste 可): ✅/⚠️/❌ — <根拠>
- Test 5 (Pointers ≤4 + reachable): ✅/⚠️/❌ — <根拠 + Glob 確認結果>

**Red flag (過剰圧縮)**: 該当なし / <列挙>

## 7. 規律 ledger (G1-G8 gate 通過状況)

| Gate | Skill | Status |
|---|---|---|
| G1 | `/session-handoff check` (orient) | ✅/⚠️/❌ |
| G2 | `/harness-work` (Plans 駆動) or 代替 | ✅/⚠️/❌ |
| G3 | `/parallel-worktree` or 代替 | ✅/⚠️/❌ |
| G4 | `harness:codex-sync` Agent | ✅/⚠️/❌ |
| G5 | `/pseudo-coderabbit-loop --local --profile=chill` | ✅/⚠️/❌ |
| G6 | `/coderabbit-review <pr>` | ✅/⚠️/❌ |
| G7 | `/codex-team` (敵対的 Phase 7) | ✅/⚠️/❌ |
| G8 | `/session-handoff update + archive` | ✅/⚠️/❌ |

**違反**: 0 件 / <件数 + 詳細>

## 8. 引継 docs 状態 (handoff health)

- `current.md`: <N> 行 (90 warn / 120 hard、Test 1-5 全 ✓)
- `backlog.md`: <N> 行 (150 warn、completed entry を ✅ で marker、carry-over 明示)
- `archive/session-<YYYY-MM-DD>-<phase-slug>.md`: <KB>KB (Session summary / Design decisions / Open issues / Commits / Review statistics 全 section 揃)
- `design-decisions` chain: <最新 `<decision-id>`>
- Memory: <追加 entry 一覧 or 該当なし>

---

**完成判定 (self-check)**: 全 8 sections emit ✓ / Post-Check Verification 全 ✓ / Skill tool 経由 archive 済 ✓ → ユーザー「完璧ですか?」不要
````

## Consumer-side override (project-specific 拡張)

If your project has additional persistent fields (e.g. compliance attestation,
release vehicle, on-call rotation), keep a consumer memory named
`reference_session_final_report_template.md` that **adds sections after Section 8**
or **enriches the placeholders inside an existing section**. Do not renumber the
8 base sections — downstream readers (next-session agent, reviewers) rely on
the fixed order.

The plugin's `archive` subcommand will surface both this generic template and
the consumer memory; merge them at emit time.

## 関連 (related)

- `commands/session-handoff.md` § `archive` subcommand step 5 (最終報告 emit step)
- `commands/references/post-check-verification.md` (Test 1-5 詳細、Section 6 で参照)
- `docs/handoff-stop-reminder-sample.md` (generic Stop hook、stale 検出 → reminder)
- consumer-side memory: `reference_session_final_report_template.md`
  (project-specific 拡張がある場合の override mechanism)

---

**version**: v1.0 — 2026-04-27 initial split from `commands/session-handoff.md`
