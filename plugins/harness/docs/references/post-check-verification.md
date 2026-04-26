# Post-Check Verification (Test 1-5)

> Companion to `commands/session-handoff.md` § `check` subcommand. Use this
> after `check` returns a verdict to confirm the **Required 4 sections** of
> `current.md` were not slim-trimmed into anti-pattern #4 (archive 必読化).

## Why this verification exists

`check` PASS is **necessary but not sufficient**. The 3-gate diagnostic
catches structural integrity, content extraction, and staleness, but it
**cannot judge whether the slim-trimmed `current.md` still lets the next
session start without opening any archive file**. Past sessions have
slimmed `current.md` to satisfy the 120-line hard limit by moving
`<decision-id>` 1-line takeaways and per-track verification metadata
into archive, succeeding the structural test but failing humans (next
session needed archive Read to grasp invariants).

Post-Check Verification is the **manual sanity bridge** between the
mechanical `check` result and "next session is truly ready to start."
Run it every time `check` returns `PASS` or `WARN`, and re-run after any
`update` that materially changed `current.md`.

## Test 1-5 (manual checklist)

After `check` PASS / WARN, Claude / human must confirm each of:

- [ ] **Test 1 — Latest state 具体性**: branch + commit hash
      (`git cat-file -e <hash>`) + merge status (PR-based なら commit hash
      + tests pass + merge SHA). `✅` 略記のみ不可、verification metadata 必須。
- [ ] **Test 2 — Top Priority 即着手性**: 5 行以内で具体 command + 対象 file +
      行範囲。曖昧 verb (「対応」「進める」「整える」) のみは不可。
- [ ] **Test 3 — 確立 invariant 1 行 takeaway** (恒久 `<decision-id>` 体系のみ、
      Required Sections 5th 対応): ID + 1 行 takeaway 列挙、ID + takeaway は
      `current.md` 必須 (詳細 rationale は archive 移送可)。`<decision-id>`
      体系を持たない project では N/A 扱い。
- [ ] **Test 4 — Quick-start copy-paste 可**: bash block 完結 (cwd → 実行 →
      cleanup)、placeholder は `<...>` で明示。
- [ ] **Test 5 — Pointers 4 件以下 + reachable** (anti-pattern #7 / S-10):
      max 4 link、`Glob` で実在確認、命名 spec 準拠。

## Red flag (過剰圧縮、いずれか該当 = anti-pattern #4 を犯している)

`check` 直後の Post-Check Verification を進めるなかで以下のいずれかを観測したら、
**即座に `update` で current.md を補強**してから再 `check`:

- `<decision-id>` 列挙のみで 1 行説明なし (anti-pattern #4 の典型)
- `✅ merged` のみで verification metadata なし (Test 1 違反、commit hash や
  tests pass 数が抜け落ちている)
- `current.md` Read のみで「即把握」 verify 不可
  (Required 4 strict 適用の失敗例、archive 必読が回避不能)

**Gate 1 PASS だけで「完璧」と即答しない**。strict 適用と anti-pattern #4
両立が完成条件。Test 1-5 ❌ なら `update` で補強 → 再 `check` → Test 再走行。

## Slim 化判断の優先順位 (90→120 行 budget 配分)

`current.md` の行数 budget に収めるとき、優先度の高いものから残す:

1. **必須残存** (削るな): Latest state table / Top Priority Next Task /
   Quick-start / Pointers (4 項目、Required Sections)
2. **準必須残存** (要点のみ残し詳細は archive へ): 確立 invariant の 1 行
   takeaway、各 Track / PR の merge status (PR + commit + tests pass 数)
3. **archive へ移送可** (current から削除 OK): セッション学び / 設計
   rationale 詳細 / Phase 履歴 / 詳細 review log / 削除済 carry-over

## 検証フロー (recommended)

```bash
wc -l <project>-current.md       # 90 未満を目標、120 上限
/session-handoff check           # Gate 1-3 PASS 確認
# その上で Test 1-5 を Claude / 人間が手で確認
# Red flag 該当があれば update → 再 check → Test 1-5 再走行
```

## 関連 (related)

- `commands/session-handoff.md` § `check` subcommand (3-gate)
- `commands/session-handoff.md` § Required Sections in `current.md`
  (Section 5 invariant takeaway)
- `commands/session-handoff.md` § Anti-patterns #4 (archive 必読化)
- `docs/references/final-report-format.md` (Section 6 で本 Test 1-5 を
  emit する設計)

---

**version**: v1.0 — 2026-04-27 initial split from `commands/session-handoff.md`
(spec body から detail を分離して 500 行台に復帰)
