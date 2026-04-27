# Hook decision / additionalContext spec compliance

> **Status**: confirmed (本 PR)
> **Owner**: harness core (`plugins/harness/core/src/index.ts` dispatcher)
> **Source of truth**: <https://code.claude.com/docs/en/hooks> (一次資料、2026-04-28 確認)

## なぜこの doc が必要か

Anthropic Claude Code hook 公式 spec は hook ごとに **`decision` 許容値** と
**`additionalContext` の出力位置** が異なる。harness plugin はかつて全 hook で
`decision: "approve"` + `additionalContext` (top-level) を返していた legacy
実装があったが、これは公式 spec 違反である。

本 doc は:
1. 公式 spec が hook ごとに何を許容するかの一覧
2. dispatcher (`index.ts`) が wire output をどう整形するかの contract
3. 関連する design decision (Track A spec compliance / Phase B2 / B-3g) の最終判断

を 1 箇所に固定する。新 hook 追加 / dispatcher 改修時の reference として参照する。

## Anthropic 公式 spec の許容値表 (一次資料 2026-04-28)

| Hook | `decision` 許容値 | `hookSpecificOutput.additionalContext` | 備考 |
|---|---|---|---|
| SessionStart | (非サポート、omit のみ) | ✅ documented | `decision` field 自体が non-spec |
| UserPromptSubmit | `"block"` (omit to allow) | ✅ documented | top-level `additionalContext` も documented |
| Stop | `"block"` (omit to allow) | (未文書化) | `"approve"` は許容値外 |
| SubagentStop | `"block"` (omit to allow) | (未文書化) | Stop と同 semantics |
| PreCompact | `"block"` (omit to allow) | (未文書化) | Stop と同 semantics |
| ConfigChange | `"block"` (omit to allow) | (未文書化、`policy_settings` は block 無視) | |
| PostToolUseFailure | `"block"` (omit to allow) | ✅ documented | |
| SubagentStart | (非サポート、omit のみ) | (未文書化、`Shows stderr to user only`) | |
| PreToolUse | `"allow"\|"deny"\|"ask"\|"defer"` (legacy `"approve"\|"block"` mapping あり) | (使用しない、`hookSpecificOutput.permissionDecision` を使う) | guardrails で別経路 |
| PostToolUse | `"block"` (omit to allow) | (未文書化) | |

**Decision 共通パターン**: blocking 可能 hook は `decision: "block"` のみ許容、
omit (= `decision` field を出さない) で proceed。`"approve"` リテラルはどの
hook の wire output 仕様にも documented されない。

**additionalContext 共通パターン**: 公式に明示 documented なのは
SessionStart / UserPromptSubmit / PostToolUseFailure の 3 hook のみ。
他 hook の `hookSpecificOutput.additionalContext` は未文書化。

## dispatcher contract (`plugins/harness/core/src/index.ts`)

`main()` の wire output 整形分岐は以下の通り:

### Branch 1: `permission` (raw stdout)

guardrails の permission hook は custom permission-reason JSON を `systemMessage`
field に load し stdout に書き出す。

### Branch 2: `worktree-create` (blocking protocol)

公式 command hook spec に従い、成功時は worktree absolute path を raw stdout、
失敗時は stderr + exit 1。

### Branch 3: modern hookSpecificOutput lift

以下 8 hook を含む:

- `user-prompt-submit` → hookEventName `"UserPromptSubmit"`
- `post-tool-use-failure` → `"PostToolUseFailure"`
- `config-change` → `"ConfigChange"`
- `subagent-start` → `"SubagentStart"`
- `session-start` → `"SessionStart"`
- `stop` → `"Stop"` (本 PR で追加)
- `subagent-stop` → `"SubagentStop"` (本 PR で追加)
- `pre-compact` → `"PreCompact"` (本 PR で追加)

整形ルール:
1. `result.decision === "block"` のみ wire `out["decision"] = "block"` に lift。
   `decision: "approve"` sentinel は **wire output から omit** (公式 spec 準拠)
2. `result.additionalContext` を `hookSpecificOutput.additionalContext` に lift
3. `result.systemMessage` (or safe-fallback reason) を top-level `systemMessage`
   に load
4. `result.continue / stopReason / suppressOutput` を top-level lift

**未文書化 hook での hookSpecificOutput.additionalContext lift について**:
Stop / SubagentStop / PreCompact / ConfigChange / SubagentStart で
`hookSpecificOutput.additionalContext` は公式に documented されていない。
ただし PostToolUseFailure / UserPromptSubmit / SessionStart で documented
された pattern と同形式の forward-compat hardening として採用する
(D-115 locale-neutral / defensive policy 継承)。Anthropic runner が無視した
としても、(a) `decision: "approve"` 違反は完全解消、(b) top-level non-spec
field の汚染は除去、(c) 将来公式 documented 化された場合 zero migration、
の 3 点で改善されている。

### Branch 4: legacy `JSON.stringify(result)`

以下の hook が残る (harness 独自 hook + 一部 guardrail):

- `pre-tool` / `post-tool` (guardrails、`HookResult` を raw 出力)
- `task-created` / `task-completed` (harness 独自 hook、Anthropic 公式 hook 名でない)
- `worktree-remove` (harness 独自 hook)
- `session-end` (legacy stub、bare approve)

これらは Anthropic 公式 spec の対象外、または public API として exposed されない
internal sentinel として `HookResult.decision` + `HookResult.reason` の legacy
shape を出力する。

## Phase B2 判断: custom hook decision interface (本 PR 確定)

**問題**: harness 独自 hook (task-lifecycle / worktree-lifecycle) は
Anthropic 公式 hook 名でない event を internal dispatcher で発火する。
これらの handler は `decision: "approve" | "block"` を internal sentinel
として返す。`status: "ok" | "block"` への rename を Codex Track B 調査で
推奨されたが、breaking change 影響を考慮して **現状維持** と決定。

**根拠**:
1. **これらは public API として exposed されない**: Anthropic Claude Code runner
   は `task-lifecycle` / `worktree-lifecycle` event を直接 dispatch しない。
   harness 内部 dispatcher が独自に fire する custom event であり、wire output
   形式が公式 spec と乖離しても外部影響なし
2. **dispatcher 経由の lift は機能上正しく動作中**: 現 dispatcher は
   `decision === "block"` のみ wire output に lift し、`"approve"` sentinel は
   omit する設計。custom hook でも同じ pattern が保たれる
3. **breaking change cost が利得を上回る**: handler 単体 test / downstream
   import で `decision === "approve"` を assert する箇所を更新する必要があり、
   migration コストが高い。一方で改善される `interface 一貫性` 効果は薄い

**将来検討**: 新 custom hook を追加する設計者が既存 sentinel を見て
混乱した場合、`docs/maintainer/custom-hook-conventions.md` (新規) で
"`decision: \"approve\"` は internal sentinel、wire output には出ない" と
明記する。

## B-3g 判断: project-specific flag naming guard (本 PR 確定)

**問題**: `generality.test.ts` の B-3g pattern は project-specific flag
(`maintainer-mode|model-b-mode|parts-management-mode|script-generate-mode|new-partslist-mode`)
を固定 list で block する R2 violation 検出器。Codex Track B 調査で generic
regex (`/--[a-z][a-z0-9-]*-mode\b/`) への発展可能性が示唆されたが、
**現状の固定 list を維持** と決定。

**根拠**:
1. **false-positive 多発リスク**: generic regex は `--strict-mode` /
   `--debug-mode` / `--dry-run-mode` 等の汎用 CLI 設計も誤検出する。
   negative test で除外しても allowlist 管理コストが高い
2. **段階移行が安全**: pilot (warn only) → allow list (除外明示) → block
   (固定昇格) の 3 段階が prudent。即 generic 化は飛び級
3. **既知の漏洩 case は cover 済**: 現 5 entry list で過去観測された全
   pattern を cover している。新規 leak が発生したら entry を追加する
   incremental 運用で十分

**将来検討**: 新 project-specific flag が出現したら B-3g entry に追加。
4 ヶ月以上にわたり entry 追加が頻発するようになったら、その時点で generic
regex 化 (allowlist 併用) を再検討する。

## Reference

- 公式 hooks reference: <https://code.claude.com/docs/en/hooks>
- gen-21 D-118 (SessionStart 部分対応): `archive/session-2026-04-27-gen21-3track-decision-skills-sanitize.md`
- 本 Track A spec compliance (本 PR 完成): `archive/session-2026-04-28-gen22-*.md` (本 session)
- Codex Track A 調査結果: 本 PR session log 内
- Codex Track B 調査結果: 本 PR session log 内
