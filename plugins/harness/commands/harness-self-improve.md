---
name: harness-self-improve
description: "Session 末尾の振り返りから改善 backlog item を自動抽出する skill。handoff archive の Open issues / Anti-pattern observations / 規律違反 ledger を読み、shipped spec に reflect すべき改善点をまとめて backlog 更新 + 改善 PR helper の起票案を提案する。長期 session で蓄積した学びを harness 進化に feedback ループする目的。"
description-ja: "session 末尾の振り返りから改善 backlog を抽出し、harness 自己改善 PR の起票案を提案する skill。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "TaskCreate", "TaskUpdate", "TaskList"]
argument-hint: "[archive-file|since-date|since-session|format|dry-run]"
---

# `/harness-self-improve` — 振り返り駆動の改善 backlog 抽出

## Synopsis

Session 末尾に handoff archive (`.docs/handoff/archive/session-<date>-*.md`)
の構造を読み、「Open issues」「Anti-pattern observations」「規律違反
ledger 追記」「Codex audit 一次資料 finding」等の **学びを蓄積する
section** から、harness plugin 側に reflect すべき改善 candidate を
抽出する。

抽出した candidate は次の二系統に振り分ける:

1. **Plugin 改修 backlog item** — `<project>-backlog.md` の `[High]` /
   `[Med]` セクションに追記する候補。`harness-itself` (meta-session) で
   即座に着手するもの、または consumer 側で feedback を蓄積し四半期で
   bulk PR を出すもの。
2. **改善 PR 起票 helper** — 抽出済 candidate のうち shipped spec の小規模
   修正で完結するものは、PR title / body / commit message の draft を
   生成。実 PR 起票は coordinator が judgment ベースで gate する。

## Trigger

- ユーザーから「振り返って、改善ポイントを backlog に入れて」「self-improve
  発動」「`/harness-self-improve`」と明示指示があった時
- session 末尾 (handoff archive 直前) で coordinator が自発的に呼ぶ時
- 四半期レビュー (transferable lessons の plugin 還元タイミング) の前に
  bulk 抽出する時

## Steps

### Step 1: archive scope の決定

引数 `[archive-file|since-date|since-session|format|dry-run]` に従い対象範囲を確定。
default は **直近 1 session archive**。

```bash
# default (most recent archive)
/harness-self-improve

# explicit file
/harness-self-improve archive-file=.docs/handoff/archive/session-2026-04-28-gen25-*.md

# since date (multiple archives)
/harness-self-improve since-date=2026-04-25
```

### Step 2: 学習 section の抽出

各 archive file から以下の section を読む (案内 regex):

| 抽出対象 section | regex anchor |
|---|---|
| Open issues / 残件 | `^##\s*(?:Open\s+issues|残件)` |
| Anti-pattern observations | `^##\s*Anti[\s-]?pattern\s+observations` |
| 規律違反 ledger 追記 | `^##\s*規律違反\s*ledger` |
| Codex audit findings | `^###?\s*Codex\s+(?:audit|review)` |
| Recommended remediation | `^##\s*Recommended\s+(?:Remediation|改善)` |

各 section の bullet list / numbered list を抽出して candidate item として
parse する。

### Step 3: candidate の正規化

各 candidate を以下の構造に正規化:

```yaml
candidate:
  origin_archive: session-2026-04-28-gen25-*.md
  category: open-issue | anti-pattern | discipline-violation | audit-finding
  severity: critical | high | medium | low | info
  scope: plugin-spec | consumer-flow | docs | tests | infrastructure
  one-line-summary: <抽出 1 行>
  detail: <抽出 detail block>
  proposed-action: <plugin reflect 案 / consumer flow 修正案>
```

### Step 4: backlog refletion

以下の判定で `<project>-backlog.md` への追記候補を絞る:

- **plugin-spec scope** + **critical / high** → backlog `[High]` 追記候補
- **anti-pattern + structural** → backlog `[High]` (構造解決 PR の root cause)
- **audit-finding + 一次資料 driven** → backlog `[Med]` (継続調査 / cross-ref)
- **discipline-violation + recurrence** → ledger entry update

### Step 5: 改善 PR helper の起票案生成

backlog candidate のうち以下条件を満たすものは、即着手可能な改善 PR の
draft を生成:

- shipped spec の小規模修正 (1-2 file 範囲、< 100 LOC 想定)
- TDD red test を書ける明確な assertion 候補がある
- 既存 quality gate (Pseudo CR / Real CR / Codex Phase 7) で逃れる
  classes of finding ではない

PR draft は以下の形式:

```markdown
**Title**: `[fix|feat|test|refactor]: <summary>`
**Body**:
## 概要
<problem statement>

## 背景
<archive citation: session-<date>-<slug>.md の Open issue X / Anti-pattern Y>

## 変更案
<file paths + 変更 sketch>

## 想定 test
<TDD red test outline>

## レビュー観点
<R1-R3 generality / D-NN integrity / 既存 invariant への影響>
```

実 PR 起票は coordinator の judgment + ユーザー確認の両 gate を通してから
実施 (本 skill は draft のみ提供、auto push は禁止)。

## Output

skill 完了時に以下を返す:

1. **Backlog candidate count**: 抽出した item 数 + severity breakdown
2. **Backlog reflection diff**: `<project>-backlog.md` への追記 diff
   (dry-run なら 出力のみ、`format=apply` で commit + push)
3. **PR draft list**: 起票 draft text (TaskList で各 draft を 1 task に
   登録、coordinator が後日着手)
4. **Skipped items**: scope 外 / consumer-only / 既存 backlog 重複 等で
   除外した item の rationale

## Anti-patterns (本 skill が避けるべきこと)

- archive を読まずに「最近の session で得た学び」と LLM 直接 generate
  (= 幻覚 risk、archive の literal 引用必須)
- 抽出 candidate を **無条件で backlog に追記** (重複 / 既解消 item を
  scrub する dedup step を必ず通す)
- PR draft の **自動 push** (coordinator + ユーザー gate を skip しない)
- shipped spec に **internal tracker ID** を leak する candidate を採用
  (R2 generality 規律遵守、抽出時に自動 scrub)

## Notes

本 skill は読み取り中心 (archive / backlog) + 提案出力で、書込みは
backlog 追記のみ (それも `format=apply` で明示 opt-in)。session-handoff
skill との関係:

- `/session-handoff archive`: session 終了時に archive 生成
- `/harness-self-improve`: archive を input に改善 candidate を抽出
  (本 skill)
- `/session-handoff update`: 抽出済 candidate を backlog に reflect する
  際に併用

## Related

- `commands/session-handoff.md` — archive / update / check の lifecycle
- `<project>-backlog.md` — improvement candidate の reflect 先
- `<project>-design-decisions.md` — 確立 invariant の append-only 履歴
