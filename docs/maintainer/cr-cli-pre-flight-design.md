# CR CLI Pre-Flight 設計検討 (Phase 5.5.5)

**Status**: Design draft (carry-forward proposal、実装は別 PR で実施)
**Author**: 本 doc は generic な maintainer note、特定 PR / Phase に紐付かない
**Date**: 2026-05-03 (本 doc 起草日)

---

## 背景 (Why)

`/pseudo-coderabbit-loop` skill は現在以下の fallback chain で動作:

1. **Step 2.0 — CR CLI 検出** (`cr-cli detect`): coderabbit binary が install + auth 済か確認
2. **Step 2.0.1 — CR CLI 直呼出** (`cr-cli review`): NDJSON output を tmp file に capture
3. **Step 2.0.2 — coderabbit-mimic fallback**: CR CLI 不在 / rate-limited / early termination 時に Codex 経由の疑似レビュー

実 dogfood (gen-31 期、複数 PR で観測) で発覚した **CR CLI early termination** パターン:

- `coderabbit --version` = OK (`v0.4.3` 検出済)
- `coderabbit auth status` = interactive UI で stuck (terminal type が不一致 / pty 未割当)
- `cr-cli review` = NDJSON 7 lines (`status:connecting → setup → analyzing → reviewing`) で stop、`finding` event 0 件
- exit code 0 (false success) → `findings_count == 0` で `clear=true` 誤判定リスク

**問題**: false success (early termination) → mimic agent fallback が走らず Pseudo CR が **空 review** で pass → push 後 Real CR が初めて実 review = 設計意図 (push 前にカリング) を満たさない。

---

## 設計提案 (What)

### 1. opt-in flag in `harness.config.json`

```jsonc
{
  "coderabbit": {
    "cliPreReview": {
      "enabled": false,             // default off — 既存 consumer に影響なし
      "requireFindingEvent": true,  // NDJSON で type=finding 1 件以上ないと "完走" と認めない
      "fallbackOnEmpty": true,      // empty findings で mimic agent fallback を強制
      "earlyTerminationDetection": {
        "lastEventStateAllowlist": ["completed", "summarized", "review_completed"],
        "rejectStates": ["reviewing", "analyzing", "setting_up"]
      }
    }
  }
}
```

**Rationale**:
- `enabled: false` default = 既存 consumer (cliPreReview 未設定) は現行 fallback chain を変えない
- `requireFindingEvent: true` で false success を防ぐ (空 findings は fallback trigger)
- `earlyTerminationDetection` で NDJSON 最終 event の状態を validate (`reviewing` で stop = early term と判定)

### 2. `/pseudo-coderabbit-loop` Step 2 拡張

```bash
# Step 2.0.1 末尾に追加 (CR CLI 直呼出が 0 exit で完了した後)

if [ "$USE_CR_CLI" = "true" ]; then
  # ... 既存 NDJSON parse ...

  # NEW: early-termination guard (cliPreReview.earlyTerminationDetection)
  LAST_EVENT_STATE=$(python3 -c "..." )  # last status event state
  FINDING_COUNT=$(jq -s '[.[] | select(.type=="finding")] | length' "$TMP_NDJSON")

  if [ "$LAST_EVENT_STATE" != "completed" ] && [ "$LAST_EVENT_STATE" != "summarized" ]; then
    echo "WARN: CR CLI ended in early state '$LAST_EVENT_STATE' — falling back to mimic"
    USE_CR_CLI="false"  # trigger Step 2.0.2
  elif [ "$FINDING_COUNT" -eq 0 ] && [ "${CLI_REQUIRE_FINDING:-true}" = "true" ]; then
    # cliPreReview.fallbackOnEmpty が true なら mimic に逃がす
    echo "WARN: CR CLI completed with 0 findings — verifying via mimic agent"
    USE_CR_CLI="false"
  fi
fi
```

**False success の防止**:
- `phase=reviewing` で stop = `LAST_EVENT_STATE != "completed"` → fallback
- 0 findings + 真の clean は `LAST_EVENT_STATE == "completed"` で OK
- 0 findings + early term は state mismatch で fallback

### 3. 新 skill or 統合判断

**Option A: 新 skill `/cr-cli-pre-review`** — `/pseudo-coderabbit-loop` から独立
- メリット: 責務分離、CR CLI 専用 skill としてテスト容易
- デメリット: skill 数増加、user は `/pseudo-coderabbit-loop` と `/cr-cli-pre-review` を使い分け必要

**Option B: `/pseudo-coderabbit-loop` に統合** (現行 Step 2.0.1 拡張) — **推奨**
- メリット: user は `/pseudo-coderabbit-loop` 1 つで完結、internal fallback chain で透過的処理
- デメリット: skill spec が長く (現行 ~720 行)、500 行 hard limit (`content-integrity.test.ts`) 抵触リスク → `docs/references/cr-cli-pre-flight.md` に詳細分離

判断: **Option B** (統合)。spec 詳細は `docs/references/` 分離で 500 行 hard limit 維持。

---

## Implementation Plan (How)

### Phase 1: schema + fallback (1 day)
1. `plugins/harness/core/src/config.ts` の `CodeRabbitConfig` interface に `cliPreReview` field 追加
2. `validateConfig` で cliPreReview 形式 validation (`enabled` boolean, `requireFindingEvent` boolean, `fallbackOnEmpty` boolean, `earlyTerminationDetection.lastEventStateAllowlist` string[], `rejectStates` string[])
3. default = `enabled: false` (現行 fallback chain 維持)

### Phase 2: Skill 拡張 (1 day)
1. `plugins/harness/commands/pseudo-coderabbit-loop.md` Step 2.0.1 末尾に early-term guard 追加
2. NDJSON last event state parse (python3 stdlib で yaml-free 実装)
3. `cliPreReview.enabled = true` のときだけ guard 起動 (consumer opt-in)

### Phase 3: vitest test (0.5 day)
1. early termination patterns (8 sample NDJSON streams):
   - `phase=reviewing` で stop → fallback
   - `phase=analyzing` で stop → fallback
   - `phase=connecting` で stop → fallback
   - `phase=completed + 0 findings` → 真の clean (fallback なし)
   - `phase=completed + N findings` → 通常処理
   - `phase=summarized + 0 findings` → 真の clean
   - exit code 429 (rate-limited) → fallback (既存処理、regression check)
   - JSON parse error → fallback (既存処理、regression check)

### Phase 4: docs (0.5 day)
1. `docs/references/cr-cli-pre-flight.md` 新設 (early-term spec 詳細、~150 行)
2. `pseudo-coderabbit-loop.md` Step 2 補遺に link (cross-reference)
3. README "Configuration" section に `cliPreReview` 例追加 (3 行 sample)

**Total**: 3 day 見込み。実装は別 PR で実施。

---

## 関連 backlog / 経緯

- gen-25: Phase 5.5.5 (CR CLI pre-flight) 設計検討 = 本 doc の対象
- gen-31: 本 session で CR CLI v0.4.3 + coderabbit-mimic fallback chain 実運用済 (PR #79/#80/#81/#82/#83 で複数 PR で観測)
- 本 dogfood (gen-31): false success (early term) 1 件観測 (cc-triad-relay PR #81 着手中、CR CLI が `phase=reviewing` で stop)

---

## 残 design question (open issues)

1. **Bucket 帰属の確定**: PR review (`gh api comment + push trigger`) と CLI review (`coderabbit --agent` 直呼出) の rate-limit bucket が独立か共有か、CodeRabbit 公式 docs で **未確認**。Phase 1 実装時に empirical 検証 (CLI を 5 回連続呼出 → PR review が rate-limit hit するか観察)
2. **NDJSON `phase` enum の正典**: `setting_up` / `analyzing` / `reviewing` / `summarized` / `completed` 等の値が公式 docs に **schema-level で公開されていない** (本 doc は実観測ベース)。Phase 1 実装時に CR CLI source (公開されている範囲) で enum 確認 + fallback として regex match (`/^reviewing/`) で柔軟対応
3. **timeout 統合**: 既存 `analyzerTimeoutSeconds` (`harness.config.json.codeRabbit`) との重複可能性。Phase 1 実装時に「`analyzerTimeoutSeconds` 経過 → kill → early term と扱う」を統合判定する経路を検討

---

## 本 doc の取扱

本 doc は **設計検討のみ** で実装を含まない。Phase 1 実装に着手する別 PR で本 doc を reference し、Phase 1-4 plan に従って progressive に実装する。

実装 PR が merge されたら、本 doc は `docs/maintainer/` に残置 (歴史的 design rationale として archive)、または `docs/references/cr-cli-pre-flight.md` に再構成して spec 詳細部分を移送 (Phase 4 step 1)。
