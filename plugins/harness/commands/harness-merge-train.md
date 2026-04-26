---
name: harness-merge-train
description: "Multi-PR review/merge orchestration skill. Iterates a phase chain (M0-M9) over each PR — Clear judgment, rebase, pre-merge gates (Codex parallel + Pseudo CodeRabbit), push, CI wait, Real CodeRabbit Clear, Codex adversarial second opinion, squash merge, worktree cleanup, handoff sync — with fail-fast on any failure. Use when shipping 2+ open PRs in sequence, or when the user requests merge / merge-train / squash-multiple."
description-ja: "複数 PR の review/merge orchestration を skill 経路で完遂する統合 skill。各 PR に対して M0-M9 の phase chain (Clear 判定 → rebase → pre-merge gate (Codex 並列 + 疑似 CodeRabbit) → push → CI wait → Real CodeRabbit Clear → Codex 敵対的セカンドオピニオン → squash merge → worktree cleanup → handoff sync) を順次実行し、いずれかで失敗したら fail-fast で停止。`/harness-work` v5 の merge mode から委譲される、または直接 `/harness-merge-train [PR# ...]` で起動可能。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Skill", "Agent", "Monitor", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]
argument-hint: "[pr-number|filter|order|dry-run|profile|max-iterations|no-commit|no-skill-fallback]"
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
> append-only 追記する責務を持つ。consumer は `harness.config.json` の
> `work.qualityGates.disciplineLedgerPath` (project-relative path) に ledger
> file を宣言し、本 skill はその path に対し `core/src/work/ledger-cli.ts`
> 経由で 1 行 markdown table row を atomic append する。path 未宣言の
> project は no-op で素通り (opt-in)。手動 rebase / 手動 squash merge /
> Codex Phase 7 skip は構造規律違反として記録対象。

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
| 複数 PR (引数指定) | `/harness-merge-train <pr-a> <pr-b> <pr-c> <pr-d> <pr-e>` |
| 自分の open PR を全て | `/harness-merge-train --filter='.[] \| select(.author.login=="me" and .state=="OPEN")'` |
| 特定 label 付き PR を一括 | `/harness-merge-train --filter='.[] \| select(.labels[].name=="ready-to-merge")'` |
| merge 順序指定 | `/harness-merge-train <pr-a> <pr-b> --order=<pr-a>,<pr-b>` (default は番号昇順) |
| plan 表示のみ | `/harness-merge-train <pr-a> <pr-b> --dry-run` |
| profile 指定 | `/harness-merge-train <pr> --profile=assertive` |

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

```text
/harness-merge-train <pr-a> <pr-b> <pr-c> <pr-d> <pr-e>
```

各 PR 番号は数字のみ受理 (regex `^[0-9]+$`、誤ったときは fail-fast)。

### Flags

| flag | 説明 | default |
|---|---|---|
| `--filter=<jq>` | `gh pr list --json` 経由 jq filter (positional 引数と排他) | - |
| `--order=<順序>` | merge 順序を明示 (`<pr-a>,<pr-b>,<pr-c>` のような CSV)。未指定なら PR 番号昇順 | 昇順 |
| `--dry-run` | plan + 委譲先のみ表示、書込 / API call なし | false |
| `--profile=chill\|assertive\|strict` | Pseudo CR / `coderabbit-mimic` agent profile | env / yaml resolve |
| `--max-iterations=N` | M2 / M5 の review-loop 上限 (1 PR あたり) | 5 |
| `--no-commit` | M7 後の handoff commit を抑制 (M9 では `Edit` のみ、git commit は次 session に委譲) | false |

### 排他 / 検証

- positional PR 番号と `--filter` は排他 (両方指定で fail-fast)
- `--order` は positional 引数 (or filter 結果) の subset でなければ fail-fast
- profile が allowlist (chill / assertive / strict) 外なら WARN 出して chill に fallback

### PROFILE resolver — precedence chain

`--profile` flag を含む実行時 profile 解決は以下の precedence で評価する。
最高優先 (1) で値が見つかった時点で確定し、低位は無視する:

| 優先順位 | source | 解決ロジック | 実装状況 |
|---|---|---|---|
| 1 (最高) | `--profile=<value>` flag | 本 skill 引数解析で直接読む。allowlist (chill / assertive / strict) 外なら WARN を 1 行 stderr に出し次 source へ fallthrough | active (本 skill + `/pseudo-coderabbit-loop`) |
| 2 | env `HARNESS_CR_PROFILE` | `/pseudo-coderabbit-loop` Step 0 が trim 後 allowlist 検証。harness-local 拡張なので strict も許可、invalid は WARN + 次 source へ fallthrough | active (`/pseudo-coderabbit-loop` Step 0) |
| 3 | `harness.config.json tddEnforce.pseudoCoderabbitProfile` | loadConfig で validate 済の field を `/pseudo-coderabbit-loop` Step 0 が `jq` 経由で読む。harness-local 拡張なので strict も許可 | active (`/pseudo-coderabbit-loop` Step 0) |
| 4 | `.coderabbit.yaml` の `reviews.profile` | `/pseudo-coderabbit-loop` が yq / PyYAML / stdlib regex の 3 段 fallback で読む。allowlist (chill / assertive) 外は WARN + 次 source へ fallthrough (公式 schema 範囲外、strict は yaml 経由不可) | active (`/pseudo-coderabbit-loop` Step 0) |
| 5 (最低) | default `chill` | 全 source 不在時の固定値 | active |

**設計参照**: 同一 precedence chain の pure function 実装が `core/src/work/profile-resolver.ts` にあり、unit test は `core/src/__tests__/profile-resolver.test.ts`。bash 経路 (`/pseudo-coderabbit-loop` Step 0) は同一 chain を skill 起動 1 回分の per-invocation 解決として再現する。

**実装メモ**: 解決値は M2.2 `/pseudo-coderabbit-loop --local --profile=<resolved>` の引数に渡され、CodeRabbit 公式 profile 仕様 (chill / assertive) + harness 拡張 (strict) のいずれかになる。allowlist 外を fallthrough する判定は **解決時 1 回のみ**実行し、phase chain 内で再評価しない (1 PR 内で profile を切り替えると Pseudo CR loop と Real CR の review 観点が分裂するため)。

**strict の扱い**: `strict` は harness-local 拡張のため CLI / env / harness.config.json の 3 source でのみ許可、`.coderabbit.yaml` 経路では reject される (公式 CodeRabbit schema 範囲外)。strict を使うと nitpick 上限が 10 件まで広がり、Pseudo CodeRabbit loop で軽微指摘も拾う。

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

# 3. CR Clear / rate-limit / blocker の判定は本 phase では行わない
#    (Skill connectivity 原則: M0 は trivial state check のみ、Real CR Clear 判定は
#    `/coderabbit-review` skill (M5) に **完全委譲**。本 phase で gh api .../reviews や
#    GraphQL unresolved query を直接走らせると skill bypass になる)
```

**判定** (mergeable / mergeStateStatus 両方を見る、stale-but-mergeable を bypass しない):
- `MERGEABLE=CONFLICTING` → M1 (rebase) に進む
- `MERGE_STATE=BEHIND` (mergeable=MERGEABLE でも base ahead) → M1 (rebase) に進む
- `MERGE_STATE=BLOCKED` / `DIRTY` / `UNSTABLE` → fail-fast (該当 PR で停止、user 判断)
- `MERGEABLE=MERGEABLE` + `MERGE_STATE=CLEAN` → M2 (pre-merge gate) へ進む。**Clear / rate-limit 判定は M5 の `/coderabbit-review` skill が責任を持つ** (M0 で先取り判定しない、skill bypass 防止)
- それ以外 → M2 (pre-merge gate) を強制実行

### M1 — Rebase (mergeable=CONFLICTING または stale 時)

```bash
# WORKTREE_DIR 検出は Skill 不在 fallback section と同じ awk record parser を使う。
# `--porcelain` の出力構造は worktree path / HEAD / branch の 3 行 1 レコードなので、
# `grep "branch ..." | grep worktree` は worktree 行を含まない (常に空) → 旧実装の
# `grep -A1` も `branch + 空行` を出すだけで worktree 行を拾えない bug があった。
# bash subshell で REPO_ROOT 基点 + cd 隔離を保つ。
REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
WORKTREE_DIR="${WORKTREE_DIR:-$(
  git -C "$REPO_ROOT" worktree list --porcelain | awk -v branch="$HEAD_BRANCH" '
    /^worktree / { path = $2 }
    $0 == "branch refs/heads/" branch { print path; exit }
  '
)}"
[ -z "$WORKTREE_DIR" ] && { echo "Worktree for $HEAD_BRANCH not found — manual intervention required"; exit 1; }

cd "$WORKTREE_DIR"
git fetch origin
git rebase "origin/${BASE_BRANCH}" 2>&1 | tee /tmp/merge-train-rebase-$PR.log

# Conflict / unmerged 判定は POSIX-portable な手段で行う:
# `git diff --name-only --diff-filter=U` は dash / ash でも問題なく動作し、
# unmerged 全状態 (UU/AA/DU/UD/UA/AU/DD) を一括カバーする (旧 `git status --short
# | grep -E '^(UU|AA) ...'` は DU/UD/UA/AU/DD を見落としていた)。
UNMERGED=$(git diff --name-only --diff-filter=U)
if [ -n "$UNMERGED" ] || grep -q "CONFLICT" /tmp/merge-train-rebase-$PR.log; then
  # auto-gen artifacts (dist/ / package-lock.json) は build 再生成
  AUTOGEN_UNMERGED=$(echo "$UNMERGED" | grep -E '^(dist/|package-lock\.json)' || true)
  if [ -n "$AUTOGEN_UNMERGED" ]; then
    npm run build 2>&1 | tail -10
    git add dist/ package-lock.json 2>/dev/null || true
    git rebase --continue 2>&1 | tee -a /tmp/merge-train-rebase-$PR.log
  fi

  # source-level conflict は手動マージ必須 → fail-fast
  REMAINING_UNMERGED=$(git diff --name-only --diff-filter=U)
  if [ -n "$REMAINING_UNMERGED" ] || grep -q "CONFLICT" /tmp/merge-train-rebase-$PR.log; then
    git rebase --abort
    echo "Source-level conflict in PR #$PR — fail-fast (manual rebase required)" >&2
    echo "Unmerged files: $REMAINING_UNMERGED" >&2
    exit 1
  fi
fi
```

**規約**:
- `dist/` / `package-lock.json` 等の auto-gen artifact は build 再生成で解消可
- source-level conflict は **必ず fail-fast** (手動 rebase 後に user が
  `/harness-merge-train --order=<残り PR>` で再開)
- worktree path 抽出は `awk record parser` (porcelain 形式の 3 行 1 レコード対応)、
  unmerged 判定は `git diff --diff-filter=U` (dash/ash 含む POSIX shell 共通動作)

### M2 — Pre-merge gate (G4 強制 + G5 強制)

#### M2.1 G4: `harness:codex-sync` agent で fix 内容を独立検証

```text
Skill({skill: "codex-team", args: "review --uncommitted"})
```

または Agent tool 直接:

```text
Agent({
  subagent_type: "harness:codex-sync",
  description: "M2.1 fix verification",
  name: "merge-train-codex-<pr-id>",  # <pr-id> は spec 上のプレースホルダ、coordinator が実 PR 番号で置換
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

```text
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

> **`/coderabbit-review` skill 必須経由**。本 phase は内部で
> `gh api ... reviews` や `gh api ... commits/.../status` を **直接 polling
> しない** (skill bypass 禁止)。Stop polling 判定 (commit_status watch) と
> Merge ready 判定 (4 signal AND) は `/coderabbit-review` Step 7 が責任を持つ。
> M5 は skill の結果 (`CLEAR_STRONG` / `CLEAR_SOFT`) を **そのまま信頼** し、
> **独自 polling 禁止** (規律違反は consumer-side discipline ledger に
> append-only 自動追記される、`harness-work.md` Skill connectivity 原則 box
> 参照)。

```text
# テンプレート表記 (<PR> は当該 PR 番号の placeholder、coordinator が実値を埋込)
Skill({skill: "coderabbit-review", args: "<PR>"})

# 実際の呼出例 (coordinator が PR 番号を実値で埋めた場合のテンプレート)
Skill({skill: "coderabbit-review", args: "<pr-number-literal>"})
```

`/coderabbit-review` skill が Step 7.B.5 マトリクスで Clear 確定するまで監視 +
反復:

| STOP_POLLING | APPROVED | ACTIONABLE | UNRESOLVED | blocker | 結果 |
|---|---|---|---|---|---|
| ✅ | ✅ | 0 | — | 不在 | **CLEAR_STRONG** → M6 |
| ✅ | — | 0 | 0 | 不在 | **CLEAR_SOFT** → M6 (APPROVED でない旨記録) |
| ✅ | — | >0 | — | 不在 | **未 clear** → finding 反映 → M3 へ戻る |
| ✅ | — | 0 | >0 | 不在 | **resolve 必要** → skill が Step 6.5 で `@coderabbitai resolve` auto-issue → 30s wait → 再判定 |
| ❌ | — | — | — | — | **Stop polling 未成立** → skill が Step 3 polling 継続 |
| — | — | — | — | active | **blocker** → cooldown 待機 or `/pseudo-coderabbit-loop <pr-number>` に切替 |

`--max-iterations=N` (default 5) で M5 → M3 → M5 ループ上限を制御。超過時は
fail-fast + ledger 追記。

### M6 — Codex Phase 7 (`/codex-team adversarial`、G7 強制)

```text
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

```text
Skill({skill: "session-handoff", args: "update"})
```

`current.md` の Latest state を最新 commit (M7 の merge_commit) に更新、
backlog から該当 PR entry を削除 or `done` mark。`--no-commit` 指定時は
file 編集のみで git commit を skip (次 session に委譲)。

> **全 PR 完了後** (loop exit 時) に `/session-handoff archive` で session 単位
> archive を実施 (M9 個別 PR 単位ではなく、loop 全体に対して 1 回)。

---

## 全 PR 完了後 (Loop exit ritual)

```text
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

以下を検出した場合、本 skill は consumer-side ledger に append-only で違反
entry を追記する (隠蔽撲滅 + 透明性確保):

| 検出条件 | skillId | impact 例 |
|---|---|---|
| M2.1 で codex-sync agent spawn 失敗 → 手動 codex 直叩き fallback | `G4` | `codex-sync agent unavailable, used manual codex exec` |
| M2.2 で `/pseudo-coderabbit-loop` skill 失敗 → 直接 `coderabbit-mimic` agent fallback | `G5` | `pseudo CR skill failed, fell back to direct mimic agent` |
| M5 で `/coderabbit-review` skill 失敗 → fail-fast (gh api 直叩き fallback **禁止**) | `G6` | `coderabbit-review skill failed, fail-fast` |
| M6 で `/codex-team` skill 失敗 → 手動 Codex 呼出 fallback | `G7` | `codex-team skill failed, manual codex exec fallback` |
| `--no-skill-fallback` flag が指定されたが skill 失敗 | `M*` | `skill required, no fallback permitted` |

### 実装契約

- **設定**: consumer は `harness.config.json` の
  `work.qualityGates.disciplineLedgerPath` に project-relative path を
  宣言する (例: `.harness/discipline-ledger.md`)。未宣言なら本機能は no-op
  (opt-in)。
- **書込口**: 本 skill は `node` (or `tsx`) 経由で
  `core/dist/work/ledger-cli.js append` を呼ぶ。直接 `fs.appendFileSync` を
  shell から叩かない (path validation / markdown escape を CLI に集中)。
- **CLI invocation 例** (M5 で `/coderabbit-review` skill が失敗した想定):
  ```bash
  node "${CC_TRIAD_RELAY_ROOT}/plugins/harness/core/dist/work/ledger-cli.js" \
    append \
    --session "${SESSION_SLUG}" \
    --skill G6 \
    --impact "coderabbit-review skill failed at M5, polling fallback rejected" \
    --remediation "investigate skill error, retry after fix"
  ```
- **exit code 規約**: `0` = appended **or** no-op-no-config (どちらも
  正常)、`1` = validation error (絶対 path / parent traversal)、`2` =
  usage error (argv 不足)。skill は exit code を見て fail-fast の
  trigger 判断には使わず、**もとの violation を fail-fast** する。
- **ledger format** は consumer-side `.claude/rules/implementation-workflow.md`
  の鉄則 7 違反 ledger section と同じ markdown table 形式
  (`| Date | Session | Skill | Impact | Remediation |`)。`appendDisciplineEntry`
  が pipe / newline を escape し、O_APPEND atomic で書く。

---

## --dry-run mode

実 API call / 書込を一切行わず、以下を表示して exit:

```text
## /harness-merge-train Plan

| Order | PR# | branch | base | mergeable | M0 verdict |
|---|---|---|---|---|---|
| 1 | <pr-a> | feature/foo | main | MERGEABLE | proceed-to-M3 |
| 2 | <pr-b> | feature/bar | main | CONFLICTING | proceed-to-M1 (rebase) |
| 3 | <pr-c> | feature/baz | main | UNKNOWN | proceed-to-M0 (re-evaluate) |

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

## Skill 不在 fallback (緊急避難経路)

本 section の手順は、以下のいずれかが session 中に検出された場合にのみ適用する
**緊急避難経路**。skill が active で user-invocable な状態での使用は **構造規律違反**
として ledger に追記される。

### 発動条件

1. `/harness-merge-train` skill 自体が plugin install 老朽化で Claude Code typeahead (`/<tab>`) に出現しない
2. skill 起動時に runtime error で fail する (skill bug / dependency missing 等)
3. skill 実行中に mid-phase error で停止し、継続が阻止される
4. 上記いずれかを検出した時点で skill 修復を試みた上で、修復まで時間 cost が高い場合

### Fallback 手順

**前提:** `git status` clean (uncommitted change なし) / target PR 番号確認済。

#### Step 1: Pre-flight (status 確認)

```bash
git status
gh pr list --repo <repo> --state open --json number,title,headRefName,baseRefName
```

#### Step 2: 各 PR について rebase

各 PR worktree で順次 rebase。`dist/` / `package-lock.json` 等の auto-gen
artifacts は build 再生成で解消、source-level conflict は手動で対応:

```bash
# REPO_ROOT を保存し、ループ内で `git -C "$REPO_ROOT"` を使うことで CWD 汚染を防ぐ。
# 各 iteration をサブシェル `( ... )` で隔離し、cd の影響を次のループに伝播させない。
REPO_ROOT=$(git rev-parse --show-toplevel)

for PR_BRANCH in <branch-a> <branch-b> <branch-c>; do
  (
    # `git worktree list --porcelain` は以下のレコード構造で出力される:
    #   worktree /absolute/path/to/wt-a
    #   HEAD <sha>
    #   branch refs/heads/<branch>
    #   (空行)
    # `grep "branch ..."` だけ抽出すると path 行を失う。awk で worktree path を
    # 直前のレコード単位で覚えておき、branch 行が match した時点で path を出す。
    WORKTREE_DIR=$(
      git -C "$REPO_ROOT" worktree list --porcelain | awk -v branch="$PR_BRANCH" '
        /^worktree / { path = $2 }
        $0 == "branch refs/heads/" branch { print path; exit }
      '
    )
    [ -z "$WORKTREE_DIR" ] && { echo "Worktree for $PR_BRANCH not found"; exit 1; }
    cd "$WORKTREE_DIR"
    git fetch origin
    git rebase origin/main  # or origin/<base-branch>
    # POSIX-portable な unmerged 検出 (dash / ash / bash 共通動作)。
    # `git status --short | grep '^(UU|AA)'` は DU/UD/UA/AU/DD を見落とすため、
    # `git diff --diff-filter=U` で全 unmerged 状態を一括捕捉する。
    UNMERGED=$(git diff --name-only --diff-filter=U)
    if [ -n "$UNMERGED" ]; then
      AUTOGEN_UNMERGED=$(echo "$UNMERGED" | grep -E '^(dist/|package-lock\.json)' || true)
      if [ -n "$AUTOGEN_UNMERGED" ]; then
        npm run build 2>&1 | tail -5
        git add dist/ package-lock.json 2>/dev/null || true
        git rebase --continue
      fi
      # source-level unmerged が残っていれば fail-fast
      REMAINING=$(git diff --name-only --diff-filter=U)
      if [ -n "$REMAINING" ]; then
        echo "Source-level conflict in $PR_BRANCH — fail-fast" >&2
        echo "Unmerged: $REMAINING" >&2
        git rebase --abort 2>/dev/null || true
        exit 1
      fi
    fi
  ) || exit 1
done
```

**6 commit 以上 rebase + dist conflict 多発時の squash strategy 切替**: 連鎖的な
conflict が多発する場合は別 branch で `git reset --soft <merge-base>` → 1 commit に
集約 → push --force-with-lease → squash merge という代替手順を取る。または PR
分割。いずれも ledger に「rebase strategy 切替」として記録。

#### Step 3: 手動 pre-merge gate (G4 + G5 を skill 経由で代替)

M2 phase の pre-merge gate を skill 経由で再現:

- `/pseudo-coderabbit-loop --local --profile=chill --worktree=<path>` を各 worktree で実行
- `/codex-team review --uncommitted` で Codex 内容検証
- actionable finding が 0 になるまで修正反復

**G7 (Codex 敵対的 second opinion)** は M6 phase 相当で push 直前 (Step 4 直前) に
`/codex-team adversarial` を必ず実施。skip すると鉄則 7 G7 違反として ledger 自動追記。

#### Step 4: 手動 push (`--force-with-lease=<branch>:<expected-sha>` 必須形式)

`--force-with-lease=<branch>` 単独では `Updates were rejected` で失敗する事象が
過去に発生した (stale info reject)。**必ず branch 名 + expected SHA を併記** する:

```bash
cd "$WORKTREE_DIR"
EXPECTED_SHA=$(git rev-parse origin/$PR_BRANCH 2>/dev/null || echo "")
if [ -n "$EXPECTED_SHA" ]; then
  # 正しい記法: branch 名 + expected SHA を明示
  git push --force-with-lease=$PR_BRANCH:$EXPECTED_SHA origin "$PR_BRANCH"
else
  # 初回 push (remote tracking 未設定時) は -u で setup
  git push -u origin "$PR_BRANCH"
fi
```

#### Step 5: 手動 squash merge (各 PR 順次)

```bash
for PR_NUM in <pr-a> <pr-b> <pr-c>; do
  TITLE=$(gh pr view "$PR_NUM" --repo <repo> --json title --jq '.title')
  if ! gh pr merge "$PR_NUM" --repo <repo> --squash --subject "$TITLE"; then
    echo "PR #$PR_NUM merge failed — ledger 追記 + fail-fast"
    exit 1
  fi
  MERGE_COMMIT=$(gh pr view "$PR_NUM" --repo <repo> --json mergeCommit --jq '.mergeCommit.oid // empty')
  [ -z "$MERGE_COMMIT" ] && { echo "PR #$PR_NUM merge succeeded but mergeCommit.oid empty — manual verify"; exit 1; }
  echo "PR #$PR_NUM squash merged: $MERGE_COMMIT"
done
```

#### Step 6: Discipline ledger 追記 (Mandatory、Step 7 worktree cleanup より **前** に実施)

ledger 追記は worktree cleanup より前に行う (Step 7 で worktree 削除後は CWD 不在
となり jq / node 起動時の harness.config.json 解決経路が壊れる risk があるため)。
REPO_ROOT を保存して project root から無条件で実行する:

```bash
# REPO_ROOT 基点で固定 (CWD が削除される前に確定させる)
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
LEDGER_PATH=$(jq -r '.work.qualityGates.disciplineLedgerPath // ""' "$PROJECT_ROOT/harness.config.json")
[ -n "$LEDGER_PATH" ] && {
  node "${CC_TRIAD_RELAY_ROOT}/plugins/harness/core/dist/work/ledger-cli.js" append \
    --project-root "$PROJECT_ROOT" \
    --session "fallback-merge-train-<short-slug>" \
    --skill "merge-train-skill-absent" \
    --impact "/harness-merge-train skill 不在 (plugin reload 待機)、手動 gh pr merge --squash 経路で M0-M9 substitute 実行、quality gate M2 (G4/G5) / M5 (G6) / M6 (G7) / M9 (G8) の skill 連鎖 (consumer-side 鉄則 7 の G3+G4+G5+G6+G7+G8 複合) を手動 skill で代替実施" \
    --remediation "次 session で claude restart → plugin reload 確認、以後は /harness-merge-train skill 経由を強制"
}
```

`--skill` 値は consumer-side 鉄則 7 ledger の skill ID 規約に準拠する。本 fallback は
`/harness-merge-train` skill 全体 (内部で G3/G4/G5/G6/G7/G8 を強制) の代替経路で、
特定 phase の単一 G ID では意味論的に正確でない。よって `merge-train-skill-absent`
という複合 skill を表す semantic identifier を使い、impact 欄で具体的な代替範囲
(G3+G4+G5+G6+G7+G8) を明示する規約とする。

#### Step 7: Worktree cleanup

```bash
git worktree remove --force <path> 2>&1
git branch -D <branch> 2>&1
git worktree prune
```

> **Step 6 (ledger) を Step 7 (worktree cleanup) より前に実行する規律**: 各 PR の
> ledger 追記は worktree 削除前に終わらせる。Step 7 後は worktree path / 関連 CWD
> 不在となり jq / node 起動時の path resolve に影響が出る risk があるため、ledger
> 追記の atomicity を保証するには順序が決定的に重要。

`--skill` 値は consumer-side 鉄則 7 ledger の skill ID 規約に準拠する。本 fallback は
`/harness-merge-train` skill 全体 (内部で G3/G4/G5/G6/G7/G8 を強制) の代替経路で、
特定 phase の単一 G ID では意味論的に正確でない。よって `merge-train-skill-absent`
という複合 skill を表す semantic identifier を使い、impact 欄で具体的な代替範囲
(G3+G4+G5+G6+G7+G8) を明示する規約とする。

**ledger 追記は mandatory**。skip / 隠蔽は鉄則 7 違反 (consumer-side
implementation-workflow.md AND 判定の規律違反 transparency 規約) として **重大規律違反**
扱いになる。

#### Step 8: Plugin reload 復旧 (元 Step 8、Step 6/7 順序入替により numbering 維持)

skill 不在の root cause が plugin install 老朽化なら:

1. claude プロセス再起動 (`exit` → 再起動、または terminal 経由で restart)
2. `/<tab>` で typeahead に `/harness-merge-train` が出るか確認
3. active 化されたら通常 skill 経路に復帰、以後の merge は skill 経由を強制
4. ledger entry の remediation field に「next session: skill 経由復帰」を記入

### `--no-skill-fallback` flag との区別

本 section の fallback と既存 `--no-skill-fallback` flag は **目的が逆**:

| 状況 | flag 設定 | fallback 適用 |
|---|---|---|
| skill 実装済み + active (通常開発) | (default) | **不可** (構造規律違反) |
| skill 実装済み + bug あり | `--no-skill-fallback` | **禁止** + skill 強制 fail-fast |
| skill 実装済み + plugin 老朽化で typeahead 未出現 | (default) | **本 section 適用** |

`--no-skill-fallback` は「skill を強制使用、bug 等で失敗したら即 fail-fast」、本 section の
fallback は「skill 不在を前提とする緊急避難」。通常運用ではどちらも skill 経由が前提、
fallback は **skill が利用不可** な session でのみ許容される。

### 制約と注意事項

- ledger 追記は mandatory、skip 不可
- skill bug 検出時は fallback ASAP より skill 修復 PR を backlog に上げるのが優先
- 連鎖 rebase で source-level 手動マージが必要になった場合は fail-fast、user 判断委譲

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

```text
## /harness-merge-train 結果

| PR | M0 | M1 | M2 (G4/G5) | M3 | M4 | M5 (G6) | M6 (G7) | M7 | M8 | M9 (G8) |
|---|---|---|---|---|---|---|---|---|---|---|
| #<pr-a> | ✅ | skip | ✅/✅ | ✅ | ✅ | APPROVED | clean | merged: <sha-a> | ✅ | ✅ |
| #<pr-b> | ✅ | rebase ✅ | ✅/✅ | ✅ | ✅ | unresolved=0 | clean | merged: <sha-b> | ✅ | ✅ |

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
