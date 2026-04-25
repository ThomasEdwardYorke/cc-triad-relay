---
name: harness-merge-train
description: "Multi-PR review/merge orchestration skill. Iterates a phase chain (M0-M9) over each PR — Clear judgment, rebase, pre-merge gates (Codex parallel + Pseudo CodeRabbit), push, CI wait, Real CodeRabbit Clear, Codex adversarial second opinion, squash merge, worktree cleanup, handoff sync — with fail-fast on any failure. Use when shipping 2+ open PRs in sequence, or when the user requests merge / merge-train / squash-multiple."
description-ja: "複数 PR の review/merge orchestration を skill 経路で完遂する統合 skill。各 PR に対して M0-M9 の phase chain (Clear 判定 → rebase → pre-merge gate (Codex 並列 + 疑似 CodeRabbit) → push → CI wait → Real CodeRabbit Clear → Codex 敵対的セカンドオピニオン → squash merge → worktree cleanup → handoff sync) を順次実行し、いずれかで失敗したら fail-fast で停止。`/harness-work` v5 の merge mode から委譲される、または直接 `/harness-merge-train [PR# ...]` で起動可能。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Skill", "Agent", "Monitor", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]
argument-hint: "[PR-number...|filter|order|dry-run|profile|max-iterations|no-commit|no-skill-fallback]"
---

# `/harness-merge-train` — Multi-PR squash merge orchestrator (Phase chain M0-M9)

複数 PR の Clear 判定 + 順次 squash merge を **skill 経路で完遂** する統合 skill。
prior review で認識された `/harness-work` の **review/merge orchestration**
spec ギャップを構造的に埋める設計。skill 内で G4 (Codex 並列) / G5 (Pseudo
CodeRabbit) / G6 (Real CodeRabbit Clear) / G7 (Codex セカンドオピニオン) /
G8 (handoff sync) の各品質ゲートを **必ず** 内挿することで、手動 gh CLI 直叩き
で頻発していた skill bypass を撲滅する。

> **本 skill と consumer-side rules**: consumer プロジェクトの implementation
> workflow rule (例: `<consumer>/.claude/rules/implementation-workflow.md`) で
> AND 判定 (TDD / Codex 並列 / Pseudo CR / Real CR / Codex Phase 7 / handoff)
> が定義されている場合、本 skill はその違反検出時に consumer 側 ledger へ
> append-only 追記する責務を持つ (consumer 側で ledger path を `harness.config.json`
> の `qualityGates.disciplineLedgerPath` に宣言する想定)。手動 rebase /
> 手動 squash merge / Codex Phase 7 skip は構造規律違反として記録対象。

---

## 設計の核

| 不変条件 | 実現手段 |
|---|---|
| 全 PR が同じ品質ゲートを通る | M2 (G4 + G5) / M5 (G6) / M6 (G7) を skill 委譲で必須化 |
| user / agent からの **直接** 多 PR orchestration は disciplinary violation | 本 skill が **唯一の合法経路**、内部実装として gh / git を使うのは設計 (詳細は次節 Skill connectivity 原則) |
| 失敗時の影響範囲を最小化 | fail-fast (該当 PR で停止、残 PR は touch せず user に判断委譲) |
| 規律違反を隠蔽不可能化 | 違反検出時に consumer-side ledger へ append-only 自動追記 |

## Skill connectivity 原則

> **user / agent から直接 Bash / gh CLI 直叩きで多 PR orchestration / review /
> merge を実行するのは構造規律違反**。本 skill の **内部実装** が `gh` / `git`
> / `git worktree` を呼び出すのは設計 (skill が wrap する責務) であり、本節の
> 原則と矛盾しない。
>
> | 作業領域 | user / agent から呼ぶべき skill |
> |---|---|
> | 単一 feature → dev/main の linear merge | `/branch-merge` |
> | 複数 PR squash merge (本 skill) | `/harness-merge-train` |
> | 単一 PR の Real CodeRabbit 監視 | `/coderabbit-review` |
> | push 前の Pseudo CodeRabbit | `/pseudo-coderabbit-loop --local` |
> | Codex セカンドオピニオン | `/codex-team adversarial` |
> | Codex 並列実装 / 検証 | `harness:codex-sync` agent |
> | handoff 管理 | `/session-handoff` (init / update / archive / check) |
>
> skill が未存在の作業領域は **「spec ギャップ」** と認識し、新 skill 設計を
> 優先する。手動運用は **緊急避難のみ**、consumer-side ledger 必須。

---

## Quick reference

| 状況 | 起動例 |
|---|---|
| 複数 PR (引数指定) | `/harness-merge-train 30 31 32 33 34` |
| 自分の open PR を全て | `/harness-merge-train --filter='.[] \| select(.author.login=="me" and .state=="OPEN")'` |
| 特定 label 付き PR を一括 | `/harness-merge-train --filter='.[] \| select(.labels[].name=="ready-to-merge")'` |
| merge 順序指定 | `/harness-merge-train 30 31 --order=30,31` (default は番号昇順) |
| plan 表示のみ | `/harness-merge-train 30 31 --dry-run` |
| profile 指定 | `/harness-merge-train 30 --profile=assertive` |

## 起動経路

| 経路 | 説明 |
|---|---|
| `/harness-work` v5 merge mode 経由 | `detect_merge_orchestration()` が条件成立で本 skill を auto-dispatch |
| 直接呼出 | `/harness-merge-train [PR# ...]` を user が叩く |

`/harness-work` v5 から呼ばれた場合、PROFILE / NO_COMMIT は coordinator が
**実値に materialize 済み** で渡される (`${VAR}` 一般形式は Claude Code 公式
slash command 動的置換で **未サポート**、`$ARGUMENTS` / `$ARGUMENTS[N]` /
`$N` (0-based) と CLAUDE_* 変数のみ保証)。

---

## 入力仕様

### Positional 引数

複数 PR 番号を space 区切りで列挙:

```
/harness-merge-train 30 31 32 33 34
```

各 PR 番号は数字のみ受理 (regex `^[0-9]+$`、誤ったときは fail-fast)。

### Flags

| flag | 説明 | default |
|---|---|---|
| `--filter=<jq>` | `gh pr list --json` 経由 jq filter (positional 引数と排他) | - |
| `--order=<順序>` | merge 順序を明示 (`30,31,32` のような CSV)。未指定なら PR 番号昇順 | 昇順 |
| `--dry-run` | plan + 委譲先のみ表示、書込 / API call なし | false |
| `--profile=chill\|assertive\|strict` | Pseudo CR / `coderabbit-mimic` agent profile | env / yaml resolve |
| `--max-iterations=N` | M2 / M5 の review-loop 上限 (1 PR あたり) | 5 |
| `--no-commit` | M7 後の handoff commit を抑制 (M9 では `Edit` のみ、git commit は次 session に委譲) | false |

### 排他 / 検証

- positional PR 番号と `--filter` は排他 (両方指定で fail-fast)
- `--order` は positional 引数 (or filter 結果) の subset でなければ fail-fast
- profile が allowlist (chill / assertive / strict) 外なら WARN 出して chill に fallback

---

## Phase chain M0 — M9 (各 PR 順次)

各 PR について以下 10 phase を順次実行。1 phase でも失敗したら **fail-fast**
(該当 PR で停止、残 PR は touch しない、user に判断委譲)。

### M0 — Pre-flight (mergeable 判定 + CI 状態 + Clear 判定 + rate-limit marker)

```bash
PR="$1"  # 各 PR 番号
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# 1. mergeable / mergeStateStatus
META=$(gh pr view "$PR" --repo "$REPO" --json \
  number,headRefName,mergeable,mergeStateStatus,state,baseRefName)
HEAD_BRANCH=$(echo "$META" | jq -r '.headRefName')
BASE_BRANCH=$(echo "$META" | jq -r '.baseRefName')
MERGEABLE=$(echo "$META" | jq -r '.mergeable')
MERGE_STATE=$(echo "$META" | jq -r '.mergeStateStatus')
PR_STATE=$(echo "$META" | jq -r '.state')

[ "$PR_STATE" != "OPEN" ] && { echo "PR #$PR is not OPEN ($PR_STATE) — fail-fast"; exit 1; }

# 2. CI 状態 (必須 check が green)
gh pr checks "$PR" --repo "$REPO" --required 2>&1 | grep -E '(fail|pending)' && {
  echo "PR #$PR has failing/pending required checks — fail-fast"; exit 1;
}

# 3. Clear 判定 (Step 7.4 マトリクス: APPROVED / unresolved=0 / blocker 不在)
#    既存 /coderabbit-review skill Step 7.1-7.3 と同一 logic を本 phase で先取り評価
#    BOT_LOGIN は harness.config.json の codeRabbit.botLogin から load (default: coderabbitai)
BOT_LOGIN=$(test -f harness.config.json \
  && jq -r '.codeRabbit.botLogin // "coderabbitai"' harness.config.json 2>/dev/null \
  || echo "coderabbitai")
# review API は `[bot]` suffix 付き、issue/PR comment author は suffix なし
# (GitHub API contract、本 spec は両形式を select で同時 match)
BOT_LOGIN_REVIEW="${BOT_LOGIN}[bot]"

CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq "[.[] | select(.user.login==\"$BOT_LOGIN_REVIEW\")] | last | .state // empty")
UNRESOLVED=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $pr: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes { isResolved comments(first: 1) { nodes { author { login } } } }
        }
      }
    }
  }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" \
  --jq "[.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.comments.nodes[0].author.login == \"$BOT_LOGIN\")
    | select(.isResolved == false)] | length")

# 4. rate-limit marker (15 分以内に active なら blocker)
RATE_LIMITED=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"$BOT_LOGIN\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | last | .createdAt // empty")
```

**判定** (mergeable / mergeStateStatus 両方を見る、stale-but-mergeable を bypass しない):
- `MERGEABLE=CONFLICTING` → M1 (rebase) に進む
- `MERGE_STATE=BEHIND` (mergeable=MERGEABLE でも base ahead) → M1 (rebase) に進む
- `MERGE_STATE=BLOCKED` / `DIRTY` / `UNSTABLE` → fail-fast (該当 PR で停止、user 判断)
- `MERGEABLE=MERGEABLE` + `MERGE_STATE=CLEAN` + Clear (`CR_STATE=APPROVED` または `UNRESOLVED=0`) + rate-limit clear → 単一の skip path で **M2/M3/M4 をスキップして M5 へ** (push 不要、Clear 確定済)
- それ以外 → M2 (pre-merge gate) を強制実行

### M1 — Rebase (mergeable=CONFLICTING または stale 時)

```bash
WORKTREE_DIR="${WORKTREE_DIR:-$(git worktree list --porcelain | grep -A1 "branch refs/heads/$HEAD_BRANCH" | grep worktree | awk '{print $2}')}"
[ -z "$WORKTREE_DIR" ] && { echo "Worktree for $HEAD_BRANCH not found — manual intervention required"; exit 1; }

cd "$WORKTREE_DIR"
git fetch origin
git rebase "origin/${BASE_BRANCH}" 2>&1 | tee /tmp/merge-train-rebase-$PR.log

if grep -q "CONFLICT" /tmp/merge-train-rebase-$PR.log; then
  # auto-gen artifacts (dist/ / package-lock.json) は build 再生成
  if git status --short | grep -E '^(UU|AA) (dist/|package-lock\.json)'; then
    npm run build 2>&1 | tail -10
    git add dist/ package-lock.json 2>/dev/null || true
    git rebase --continue 2>&1 | tee -a /tmp/merge-train-rebase-$PR.log
  fi

  # source-level conflict は手動マージ必須 → fail-fast
  if grep -q "CONFLICT" /tmp/merge-train-rebase-$PR.log; then
    git rebase --abort
    echo "Source-level conflict in PR #$PR — fail-fast (manual rebase required)"
    exit 1
  fi
fi
```

**規約**:
- `dist/` / `package-lock.json` 等の auto-gen artifact は build 再生成で解消可
- source-level conflict は **必ず fail-fast** (手動 rebase 後に user が
  `/harness-merge-train --order=<残り PR>` で再開)

### M2 — Pre-merge gate (G4 強制 + G5 強制)

#### M2.1 G4: `harness:codex-sync` agent で fix 内容を独立検証

```
Skill({skill: "codex-team", args: "review --uncommitted"})
```

または Agent tool 直接:

```
Agent({
  subagent_type: "harness:codex-sync",
  description: "M2.1 fix verification",
  name: "merge-train-codex-<PR>",  # <PR> は spec 上のプレースホルダ、coordinator が実値で置換 (例: "merge-train-codex-30")
  prompt: "...",
  run_in_background: false
})
```

`harness:codex-sync` 結果に critical/major があれば → **fix 適用** → 再 codex
review (max 3 iteration) → clean まで反復。

> **subagent spawn 制約 (公式仕様)**: subagent から更に subagent を spawn する
> ことは **不可** (`disallowedTools: [Agent]` で完全禁止される)。本 skill 自身は
> top-level skill として呼ばれるため Agent tool 経由で `harness:codex-sync` を
> spawn 可能だが、`/tdd-implement` 等の他 skill 配下で間接的に呼ばれる経路では
> nested spawn の制限を踏むため、本 skill は **top-level invocation 専用** と
> 位置付ける。

#### M2.2 G5: `/pseudo-coderabbit-loop --local --profile=$PROFILE` で push 前 pre-review

```
# テンプレート表記 (<PROFILE> / <WORKTREE> は spec 上のプレースホルダ、
# coordinator が pre-flight で解決した実値を埋め込む)
Skill({skill: "pseudo-coderabbit-loop", args: "--local --profile=<PROFILE> --worktree=<WORKTREE>"})

# 実際の呼出例 (PROFILE=chill、WORKTREE=/Users/u/repo-wt-foo の場合)
Skill({skill: "pseudo-coderabbit-loop", args: "--local --profile=chill --worktree=/Users/u/repo-wt-foo"})
```

`actionable_count == 0` まで反復 (max 5 iteration、`--max-iterations=N` flag で
override 可能)。`.coderabbit.yaml` の path_instructions / profile を尊重し、
本物 CodeRabbit が後段で拾う指摘を pre-empt する。

**両 gate の AND 条件成立で M3 へ**。1 つでも fail なら fail-fast。

### M3 — Push (`--force-with-lease` 推奨)

```bash
cd "$WORKTREE_DIR"
EXPECTED_SHA=$(git rev-parse origin/$HEAD_BRANCH 2>/dev/null || echo "")
if [ -n "$EXPECTED_SHA" ]; then
  git push --force-with-lease=$HEAD_BRANCH:$EXPECTED_SHA origin "$HEAD_BRANCH"
else
  git push -u origin "$HEAD_BRANCH"
fi
```

**安全規約**:
- `--force-with-lease` は **必ず** ref 名 + expected SHA を明示 (`--force` 単独は禁止)
- 初回 push 時 (remote tracking branch 不在) は `-u` で setup
- `Bash(git push --force-with-lease=*)` permission を local settings に追加済前提

### M4 — CI wait (Monitor で green まで監視、fail 検出は明示的)

```text
Monitor({
  description: `CI for PR #<PR> (<PR> は当該 PR 番号に置換)`,
  command: `prev=""
while true; do
  s=$(gh pr checks <PR> --repo <REPO> --json name,bucket)
  # 状態変化を line per check で出力 (success / fail / cancel / skipping いずれも emit)
  cur=$(jq -r '.[] | select(.bucket!="pending") | "\\(.name): \\(.bucket)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  # fail bucket を **明示的に検出** して即 exit (silent merge を防ぐ)
  if jq -e 'any(.bucket == "fail")' <<<"$s" >/dev/null; then
    echo "FAILED_CHECK_DETECTED" >&2
    exit 1
  fi
  # 全て non-pending かつ 全て success/skipping のときのみ正常 exit
  if jq -e 'all(.bucket == "success" or .bucket == "skipping")' <<<"$s" >/dev/null; then
    echo "ALL_CHECKS_GREEN"
    break
  fi
  sleep 30
done`,
  timeout_ms: 1800000,
  persistent: false
})
```

- 全 check が `success` or `skipping` になった時点で正常 exit (`ALL_CHECKS_GREEN` 出力)
- 失敗 (`fail` bucket あり) → 即 exit 1 で **fail-fast** (`FAILED_CHECK_DETECTED` を stderr に emit、本 phase で停止 + 残 PR touch せず)
- timeout (30 分) → user に判断委譲 (CI hang or infrastructure issue 可能性)
- `<PR>` / `<REPO>` は spec 上のプレースホルダ、coordinator が実 PR 番号 / repo に置換

### M5 — Real CodeRabbit Clear 判定 (G6)

```
# テンプレート表記 (<PR> は当該 PR 番号の placeholder、coordinator が実値を埋込)
Skill({skill: "coderabbit-review", args: "<PR>"})

# 実際の呼出例 (PR=30 の場合)
Skill({skill: "coderabbit-review", args: "30"})
```

`/coderabbit-review` skill が Step 7.4 マトリクスで Clear 確定するまで監視 +
反復:

| CLEAR (strong) | CLEAR_SOFT | blocker | 結果 |
|---|---|---|---|
| `state == APPROVED` | — | — | **完全 clear** → M6 |
| — | `unresolved == 0` | rate-limit 不在 | **ソフト clear** → M6 (APPROVED でない旨記録) |
| false | false | — | **未 clear** → finding 反映 → M3 へ戻る |
| — | — | rate-limit active | **blocker** → cooldown 待機 or `/pseudo-coderabbit-loop <pr-number>` に切替 |

`--max-iterations=N` (default 5) で M5 → M3 → M5 ループ上限を制御。超過時は
fail-fast + ledger 追記。

### M6 — Codex Phase 7 (`/codex-team adversarial`、G7 強制)

```
Skill({skill: "codex-team", args: "adversarial"})
```

merge 前の最終 adversarial review。critical 発見時は **必ず M3 (修正 push)** に
戻る (skip 不可)。clean まで反復、それ以降に M7 へ進む。

> **G7 skip は構造規律違反** (鉄則 7 AND 判定)。本 skill 内で skip 検出時は
> ledger 自動追記 + fail-fast。

### M7 — Squash merge (commit hash 検証必須、empty で fail-fast)

```bash
if ! gh pr merge "$PR" --repo "$REPO" --squash --subject "$(gh pr view "$PR" --repo "$REPO" --json title --jq '.title')"; then
  echo "PR #$PR squash merge failed — fail-fast (worktree 保持 + ledger 追記)" >&2
  exit 1
fi
MERGE_COMMIT=$(gh pr view "$PR" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid // empty')
if [ -z "$MERGE_COMMIT" ]; then
  echo "PR #$PR merge reported success but mergeCommit.oid is empty — fail-fast (worktree 保持、M8/M9 skip)" >&2
  echo "  manual verification required: gh pr view $PR --repo $REPO --json state,mergedAt,mergeCommit" >&2
  exit 1
fi
echo "PR #$PR squash merged: $MERGE_COMMIT"
```

**規約**:
- `--squash` 固定 (本 skill は squash merge 専用、merge commit / rebase merge は
  `/branch-merge` 経由)
- merge 後の base branch fast-forward は M9 で実施

### M8 — Worktree cleanup

```bash
# untracked node_modules / dist 残許容 (--force で push)
git worktree remove --force "$WORKTREE_DIR" 2>&1
git branch -D "$HEAD_BRANCH" 2>&1
git worktree prune
```

- 未 stage 変更があっても `--force` で remove (CI artifact 除去のため)
- branch 削除は `-D` (-d だと merged 検出ができないケースがある)

### M9 — Handoff sync (G8 強制)

```
Skill({skill: "session-handoff", args: "update"})
```

`current.md` の Latest state を最新 commit (M7 の merge_commit) に更新、
backlog から該当 PR entry を削除 or `done` mark。`--no-commit` 指定時は
file 編集のみで git commit を skip (次 session に委譲)。

> **全 PR 完了後** (loop exit 時) に `/session-handoff archive` で session 単位
> archive を実施 (M9 個別 PR 単位ではなく、loop 全体に対して 1 回)。

---

## 全 PR 完了後 (Loop exit ritual)

```
Skill({skill: "session-handoff", args: "archive"})
```

archive ファイル名は `archive/session-<YYYY-MM-DD>-merge-train-<lead-pr>.md` を
推奨。Session summary に各 PR の merge commit / 通過した quality gate / 検出した
規律違反 (あれば ledger ID 付き) を記録する。

---

## fail-fast 時の挙動

任意の M0-M9 phase で失敗が発生したら:

1. **該当 PR で停止**、`exit 1` で本 skill 終了
2. 残り PR は touch せず、user に判断委譲 (修復後 `/harness-merge-train <残り PR> --order=...` で再開)
3. ledger 追記が必要な違反 (skill skip / 手動操作 fallback) は鉄則 7 ledger
   (`.claude/rules/implementation-workflow.md`) に **append-only 自動追記**
4. handoff backlog に "merge-train abort PR #<n>" entry を追加
5. 失敗報告 (どの phase で何が起きたか) を user に明示

---

## Discipline ledger 自動追記

以下を検出した場合、本 skill は鉄則 7 ledger に append-only で違反 entry を
追記する (隠蔽撲滅 + 透明性確保):

| 検出条件 | ledger entry 例 |
|---|---|
| M2.1 で codex-sync agent spawn 失敗 → 手動 codex 直叩き fallback | "G4 違反: codex-sync agent unavailable, used manual codex exec" |
| M2.2 で `/pseudo-coderabbit-loop` skill 失敗 → 直接 `coderabbit-mimic` agent fallback | "G5 部分違反: skill 経由失敗、agent 直接呼出 fallback" |
| M5 で `/coderabbit-review` skill 失敗 → `gh api` polling fallback | "G6 違反: skill 経由失敗、gh api 直叩き fallback" |
| M6 で `/codex-team` skill 失敗 → 手動 Codex 呼出 fallback | "G7 違反: skill 経由失敗、手動 codex 呼出 fallback" |
| `--no-skill-fallback` flag が指定されたが skill 失敗 | "fail-fast (skill 必須経路で代替不能)" |

ledger format は `.claude/rules/implementation-workflow.md` の鉄則 7 違反 ledger
section を参照 (project-local rule、harness plugin core からは `<consumer>` 表記
で参照する。pattern: `consumer-side rules path` というインターフェース契約)。

---

## --dry-run mode

実 API call / 書込を一切行わず、以下を表示して exit:

```
## /harness-merge-train Plan

| Order | PR# | branch | base | mergeable | M0 verdict |
|---|---|---|---|---|---|
| 1 | 30 | feature/foo | main | MERGEABLE | proceed-to-M3 |
| 2 | 31 | feature/bar | main | CONFLICTING | proceed-to-M1 (rebase) |
| 3 | 32 | feature/baz | main | UNKNOWN | proceed-to-M0 (re-evaluate) |

Estimated phases: 3 PR × 10 phases = up to 30 skill invocations
Estimated duration: 30-90 min (CI wait 含む)
Profile: <PROFILE>  # spec 上のプレースホルダ、runtime には実値 (chill / assertive / strict) が表示
Skill chain summary:
  M2.1 G4 → harness:codex-sync agent
  M2.2 G5 → /pseudo-coderabbit-loop --local
  M5 G6 → /coderabbit-review
  M6 G7 → /codex-team adversarial
  M9 G8 → /session-handoff update
  Loop exit → /session-handoff archive
```

---

## 互換性 / 副作用

- 本 skill は **squash merge 専用**。merge commit / rebase merge / fast-forward
  push は `/branch-merge` (linear `feature → dev → main`) を使う
- top-level invocation 専用 (公式 subagent spec 上、subagent 配下からは spawn
  不可)
- 本 skill が edit する file は当該 PR の worktree 内 + handoff `current.md` /
  `backlog.md` のみ。`design-decisions.md` の append-only invariant は守る
- 本 skill が読み取る config: `harness.config.json` の
  `codeRabbit` / `tddEnforce` / `worktree` セクション (未設定なら default)

---

## エラーハンドリング

| エラー | 対応 |
|---|---|
| 引数 PR が存在しない | M0 で fail-fast |
| `--filter` jq syntax error | 起動前に fail-fast |
| `--order` が positional の subset でない | 起動前に fail-fast |
| GitHub API rate limit | exponential backoff 30s / 60s / 120s / 240s (max 4 retry) |
| CodeRabbit 5/h 上限到達 | M5 で `/pseudo-coderabbit-loop` 切替を提案 + cooldown 待機 |
| CI hang (M4 timeout) | user に判断委譲、手動 retry を提案 |
| Real CodeRabbit が "incremental review system" として再 review 拒否 | Soft Clear (unresolved=0) で merge 進行可、ledger に notes 追記 |

---

## 関連スキル

| スキル | 役割 | 呼び出し関係 |
|---|---|---|
| `/harness-work` v5 | Plans.md 駆動 dispatcher。`merge` mode で本 skill に委譲 | caller |
| `/branch-merge` | 単一 feature → dev/main の linear merge | sibling (異なる use case) |
| `/coderabbit-review` | Real CodeRabbit Clear 3 段判定 | M5 で委譲 |
| `/pseudo-coderabbit-loop` | Codex 疑似 CodeRabbit (Phase 5.5 相当) | M2.2 で委譲 |
| `/codex-team` | Codex review / dev / adversarial | M2.1 / M6 で委譲 |
| `/session-handoff` | handoff init / update / archive / check | M9 / Loop exit で委譲 |
| `harness:codex-sync` agent | foreground Codex 並列 wrapper | M2.1 で Agent tool 経由 spawn |

---

## CodeRabbit OSS plan + Pro plan 並用

CodeRabbit OSS plan は **PR review 2/h と CLI review 2/h が別 bucket** (公式
docs 確認済、2026-04-26 時点)。Pro plan の PR review 5/h と組み合わせると:

- 同じ PR を Pro 5/h で review しつつ、`bin/cr-cli review` (OSS plan CLI 2/h)
  で independent な並列 review を取得可能
- 本 skill M2.2 内では `/pseudo-coderabbit-loop` が `bin/cr-cli` fallback chain
  を内蔵 (Step 2.0)、CR CLI 利用可能なら自動的にそちらを優先する

OSS plan 申請は CodeRabbit dashboard (https://app.coderabbit.ai/) で手動操作
(skill からは無理、user に依頼)。

---

## 完了報告 template

```
## /harness-merge-train 結果

| PR | M0 | M1 | M2 (G4/G5) | M3 | M4 | M5 (G6) | M6 (G7) | M7 | M8 | M9 (G8) |
|---|---|---|---|---|---|---|---|---|---|---|
| #30 | ✅ | skip | ✅/✅ | ✅ | ✅ | APPROVED | clean | merged: abc1234 | ✅ | ✅ |
| #31 | ✅ | rebase ✅ | ✅/✅ | ✅ | ✅ | unresolved=0 | clean | merged: def5678 | ✅ | ✅ |

- Total PRs: N
- Merged: M
- Aborted (fail-fast): A
- Discipline violations recorded in ledger: K
- Final commit on `main`: <sha>
- Session archive: archive/session-<date>-merge-train-<lead-pr>.md

`/harness-merge-train` complete.
```

---

## スキル更新履歴

- **v1 (2026-04-26)**: 初版。M0-M9 phase chain、G4-G8 skill chain
  内挿、fail-fast、`--filter` / `--order` / `--dry-run` / `--profile` /
  `--max-iterations` / `--no-commit` flags。Skill connectivity 原則を
  `/harness-work` v5 と共通化。Consumer-side discipline ledger 自動追記。
