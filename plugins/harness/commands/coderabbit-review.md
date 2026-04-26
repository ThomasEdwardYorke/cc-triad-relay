---
name: coderabbit-review
description: "Watch for CodeRabbit reviews on a GitHub PR in the background and respond to the findings automatically. Use after pushing a PR when the user asks to handle the CodeRabbit review."
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"]
argument-hint: "<pr-number>"
---

# `/coderabbit-review` — CodeRabbit review loop (background watch + auto response)

Polls a GitHub PR for new CodeRabbit reviews in the background, so the
user is not blocked. When a review lands, a desktop notification fires
and the skill applies fixes to the actionable + nitpick comments, then
re-pushes and re-polls until the review clears.

## Test command resolution

When running tests after applying fixes, this skill picks, in order:

1. `harness.config.json:testCommand`
2. `npm test` if `package.json` exists
3. `pytest` if a Python project is detected
4. Otherwise skip with a warning (do not silently claim green)

## Workflow

### Step 1. Fetch PR metadata

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
PR=<pr-number>
gh pr view "$PR" --json headRefName,state --jq '{branch: .headRefName, state: .state}'
```

If the PR does not exist, stop.

### Step 2. Has CodeRabbit already reviewed the latest push?

```bash
PUSH_TIME=$(git log -1 --format=%cI)
LATEST=$(gh api repos/${REPO}/pulls/${PR}/reviews --jq \
  '[.[] | select(.user.login=="coderabbitai[bot]")] | .[-1] | {submitted_at, state}')
```

- If `submitted_at > PUSH_TIME` → go to Step 4 immediately.
- Otherwise → go to Step 2.5 (rate limit check) then Step 3 (background watch).

### Step 2.5. Rate limit detection (NEW)

CodeRabbit は rate limit に当たると以下の HTML marker をコメントに含める。

```bash
RATE_LIMITED=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\" or .author.login == \"coderabbitai[bot]\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | last | .createdAt // empty")

if [ -n "$RATE_LIMITED" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$RATE_LIMITED" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$RATE_LIMITED" +%s) ))
  # Pro プラン: 5 PR reviews/hour、rolling bucket で 12 分/1 単位 回復
  # 保守的に 15 分 cooldown
  if [ "$ELAPSED" -lt 900 ]; then
    WAIT=$(( 900 - ELAPSED ))
    echo "RATE_LIMITED_COOLDOWN=${WAIT}s"
    # オプション: `/pseudo-coderabbit-loop <pr>` に切替を提案
    # Codex 疑似レビューで時間を有効活用可能
    exit 0
  fi
fi
```

**Cooldown 中の推奨アクション**:
- `/pseudo-coderabbit-loop <pr-number>` を起動して Codex 疑似レビューで空き時間を活用
- Cooldown 経過後に自動再試行するか、手動で `/coderabbit-review <pr>` を再起動
- **Step 2.6 (chat bucket helper) を試行** — chat 50/h は review 5/h と独立 bucket と推定されており、rate-limited 中も `@coderabbitai resolve` / `summary` / `configuration` / `help` を発行可能

### Step 2.6. Chat bucket helper (operational chat 経路、NEW)

CodeRabbit Pro plan には 2 つの rate-limit bucket があり、operational chat command は review bucket 5/h と独立で 50/h 利用可能と推定されている (公式 docs は bucket mapping を explicit に明示していないため empirical 検証が必要、本 skill 初回採用 PR で 2-3 件試走推奨):

| Command | 用途 | Review bucket への影響 |
|---|---|---|
| `@coderabbitai resolve` | 既存 reviewable thread を一括 resolve mark | 消費しない (推定) |
| `@coderabbitai summary` | PR summary を再生成 | 消費しない (推定) |
| `@coderabbitai configuration` | effective `.coderabbit.yaml` 設定を bot から発行 | 消費しない (推定) |
| `@coderabbitai help` | 利用可能な bot command を表示 | 消費しない (推定) |

review trigger commands (`@coderabbitai review` / `full review`) は **review bucket を確実に消費**するため、本 helper 経由では送れない (誤用検出として throw)。Step 4 の通常 review-trigger flow を使うこと。

#### 2.6.1 シェルからの呼出

`bin/cr-chat` で正しい syntax の `@coderabbitai <cmd>` を構築できる。bucket 分類は `cr-chat classify <cmd>` で確認:

```bash
# CR_CHAT_BIN の解決 3 段 fallback (env → PATH → HARNESS_PLUGIN_ROOT default):
if [ -z "${CR_CHAT_BIN:-}" ]; then
  CR_CHAT_BIN=$(command -v cr-chat 2>/dev/null || true)
fi
if [ -z "$CR_CHAT_BIN" ]; then
  HARNESS_PLUGIN_ROOT="${HARNESS_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/<your-marketplace>/plugins/harness}"
  CR_CHAT_BIN="${HARNESS_PLUGIN_ROOT}/bin/cr-chat"
fi

if [ ! -x "$CR_CHAT_BIN" ]; then
  echo "WARN: cr-chat binary not found; chat helper unavailable" >&2
else
  # 運用例 1: 全 thread を chat bucket で resolve
  BODY=$(node "$CR_CHAT_BIN" build resolve)
  gh pr comment "$PR" --repo "$REPO" --body "$BODY"

  # 運用例 2: bucket 誤用 gate (review trigger を chat helper 経由で送らない)
  # CMD は caller が必ず指定する (例: caller skill が "$1" を validate 済の値として渡す)。
  # standalone 実行で `$1` が empty になると classify "" が error になるため、
  # 本 helper を spec から呼ぶ場合も `${CMD:?usage: ... <command>}` 等で fail-fast する。
  CMD="${CMD:?cr-chat classify usage: provide a chat-bucket command name (e.g. resolve / summary / configuration / help)}"
  BUCKET=$(node "$CR_CHAT_BIN" classify "$CMD")
  if [ "$BUCKET" != "chat" ]; then
    echo "ERROR: '$CMD' is not a chat-bucket command (got: $BUCKET); use Step 4 review trigger instead" >&2
    exit 1
  fi
fi
```

#### 2.6.2 適用シナリオ

- **rate-limit 中の活用**: Step 2.5 で `RATE_LIMITED_COOLDOWN` が発火している間でも chat bucket は通常通り消費可能。`@coderabbitai summary` で PR 現状把握を維持
- **resolve 一括処理**: 大量 thread の resolve を chat bucket 経由で行い、review bucket 5/h を温存
- **設定確認**: `@coderabbitai configuration` で `.coderabbit.yaml` の effective 値を bot から取得 (local parse と diff 検証)
- **help discoverability**: 新メンバーが `@coderabbitai help` で利用可能 command を発見

#### 2.6.3 empirical 検証手順 (escape hatch 付き、最大 5 試行で bucket 確定)

**目的**: chat bucket 想定の 4 commands (resolve / summary / configuration / help) が実際に review bucket を消費しないことを controlled test で確認。

**注意**: 検証自体が review bucket を 5 回消費する。**運用 PR では実施せず、検証専用の test PR (例: README typo 修正だけの PR) で実施**。万一 5 回中で rate-limit に到達したら escape hatch (Step 2.6.4) で `/pseudo-coderabbit-loop <pr> --local` に切替、cooldown 中に Codex で代替レビュー継続可能。

##### 検証手順 (1 chat command につき 1 試行)

```bash
# 例: resolve の bucket 帰属を確認する 1 試行
TEST_PR=<n>; REPO=<owner/name>

# Step A: chat command を 1 回送信
node "$CR_CHAT_BIN" build resolve | xargs -I{} gh pr comment "$TEST_PR" --repo "$REPO" --body {}

# Step B: 直後に @coderabbitai review を **連続 5 回** 送信 (review bucket を埋める)
for i in 1 2 3 4 5; do
  gh pr comment "$TEST_PR" --repo "$REPO" --body "@coderabbitai review"
  sleep 30  # bot の応答を待つ
done

# Step C: rate-limit marker 検出
RATE_LIMITED=$(gh pr view "$TEST_PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\" or .author.login == \"coderabbitai[bot]\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | length")

# Step D: 結果記録 — 後述の empirical 検証ログ section に追記
#  - rate_limit_count == 0 (5 review 全通) → chat と review bucket は独立 (chat assumption ✅)
#  - rate_limit_count == 1 (4 review 通って 5 回目で rate-limit) → bucket 共有 (chat assumption ❌)
echo "rate-limit markers: $RATE_LIMITED"
```

##### 検証ログ template (本 PR description / 別 docs に append)

```markdown
### empirical 検証ログ (chat bucket attribution)

| 検証日 | command | test PR | review attempts | rate-limit markers | bucket 確定 | confidence |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | resolve | #N | 5 | 0 | chat ✅ | High |
| YYYY-MM-DD | summary | #M | 5 | 1 | review ❌ → revert assumption | High |
| ... |
```

検証で bucket 帰属が外れた command は `CHAT_BUCKET_COMMANDS` から除外する revert PR を出すこと。

#### 2.6.4 検証中の escape hatch

検証 5 試行で review bucket が枯渇 (5/5 hit) した場合、cooldown 15 分間は本 skill が rate-limited fallback path に入る。**この間も chat bucket は仮定通りなら独立で稼働中**なので:

- chat helper 経由の operational command (`build resolve` 等) は引き続き発行可能
- review trigger 系の検証は cooldown 後に再開
- `/pseudo-coderabbit-loop <pr> --local` に切替て Codex 代替レビューで時間活用可能

### Step 3. Background watch (commit_status primary + review-count fallback)

CR は per-commit review lifecycle で **commit_status** (`pending` → `success`
"Review completed") を発行することが LIVE 観測されている。これを **primary
signal** として watch し、review-count 増加は commit_status を発行しない構成
向けの **secondary fallback** に格下げる (旧実装は review-count 増加のみを
監視していたため CR の per-commit lifecycle と乖離していた)。

Run in background (`run_in_background: true`, `timeout: 600000`):

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
PR=<pr-number>
HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq '.headRefOid')
# review-count fallback も HEAD_SHA に限定 (古い commit への delayed review で
# false positive にならないよう、INITIAL/CURRENT 両方を HEAD-filtered に統一)
INITIAL=$(gh api repos/${REPO}/pulls/${PR}/reviews \
  | jq --arg head "$HEAD_SHA" -r '[.[] | select(.user.login=="coderabbitai[bot]" and .commit_id==$head)] | length' 2>/dev/null)
PREV_STATE=""

for i in $(seq 1 20); do
  # Primary: commit_status state watch (pending → success "Review completed")
  STATE=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/status" \
    --jq '[.statuses[] | select(.context | test("CodeRabbit"; "i"))] | first | .state // empty' 2>/dev/null)
  DESC=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/status" \
    --jq '[.statuses[] | select(.context | test("CodeRabbit"; "i"))] | first | .description // empty' 2>/dev/null)

  if [ "$STATE" != "$PREV_STATE" ]; then
    echo "STATE_CHANGED prev=\"$PREV_STATE\" new=\"$STATE\" desc=\"$DESC\""
    PREV_STATE="$STATE"
  fi

  if [ "$STATE" = "success" ] && echo "$DESC" | grep -qiE 'review completed|review complete'; then
    osascript -e "display notification \"CodeRabbit review completed — PR #${PR}\" with title \"Claude Code\" sound name \"Glass\"" 2>/dev/null \
      || notify-send "Claude Code" "CodeRabbit review completed — PR #${PR}" 2>/dev/null || true
    echo "STOP_POLLING_REACHED"
    exit 0
  fi

  # Secondary fallback: review-count 増加 (commit_status を発行しない CR 構成 /
  # API drift への保険、Stop polling 判定 (Step 7.A) は commit_status を primary とする)
  # HEAD_SHA 限定で INITIAL と同じ scope (古い commit への delayed review で false trigger 防止)
  CURRENT=$(gh api repos/${REPO}/pulls/${PR}/reviews \
    | jq --arg head "$HEAD_SHA" -r '[.[] | select(.user.login=="coderabbitai[bot]" and .commit_id==$head)] | length' 2>/dev/null)
  if [ "$CURRENT" -gt "$INITIAL" ] 2>/dev/null; then
    osascript -e "display notification \"CodeRabbit review arrived — PR #${PR}\" with title \"Claude Code\" sound name \"Glass\"" 2>/dev/null \
      || notify-send "Claude Code" "CodeRabbit review arrived — PR #${PR}" 2>/dev/null || true
    echo "REVIEW_ARRIVED_FALLBACK"
    exit 0
  fi

  sleep 30
done
echo "TIMEOUT"
```

Tell the user: *"Watching in the background (up to 10 min). You can
keep working — a notification will fire when commit_status flips to success."*

Background result routing:

- `STOP_POLLING_REACHED` → Step 4 (parse the review) → Step 7 (Stop polling + Merge ready 2 段判定)
- `REVIEW_ARRIVED_FALLBACK` → Step 4 (commit_status 不在環境向けの保険、Step 7 と同等処理)
- `TIMEOUT` → report, suggest re-running the skill (Clear 判定は Step 7 が行う)

### Step 4. Parse the review

```bash
gh api repos/${REPO}/pulls/${PR}/reviews --jq '.[-1].body'
```

Extract:

- **Actionable comments** — must be addressed
- **Nitpick comments** — recommended
- **Additional comments** — informational

If all three are 0 → Step 7.

### Step 5. Apply fixes

For each finding:

1. Locate the file + line.
2. Fix the **implementation**, not the test. Never rewrite a failing
   test to match the code.
3. Run the resolved test command; confirm green before proceeding.

### Step 6. Commit + push + re-watch

```bash
git add <files>
git commit -m "fix: address CodeRabbit findings

- <item 1>
- <item 2>"
git push origin "$(git branch --show-current)"
```

Return to Step 3 and wait for the next review cycle.

### Step 6.5. Auto-issue `@coderabbitai resolve` (chat bucket、unresolved>0 + actionable=0 時)

Step 6 (push) の後、Step 7 (Stop polling / Merge ready 判定) に入る前に、
**unresolved CR threads が残っているが actionable=0** の場合に限り、
`@coderabbitai resolve` を chat bucket 経由で自動 inject する。

CR の thread auto-resolve は per-comment fix が unresolved=0 を達成しないまま
繰り返し発生しがちで、Soft Clear 到達を妨げる。chat bucket (50/h、review bucket
5/h と独立) を活用して、Real CR review bucket を無駄消費せずに resolve mark を
発火する。

```bash
# CR_CHAT_BIN の解決 3 段 fallback (Step 2.6.1 と同じ)
if [ -z "${CR_CHAT_BIN:-}" ]; then
  CR_CHAT_BIN=$(command -v cr-chat 2>/dev/null || true)
fi
if [ -z "$CR_CHAT_BIN" ]; then
  HARNESS_PLUGIN_ROOT="${HARNESS_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/<your-marketplace>/plugins/harness}"
  CR_CHAT_BIN="${HARNESS_PLUGIN_ROOT}/bin/cr-chat"
fi

# unresolved 数を取得 (Step 7.B.3 の query を再利用)。
# pagination loop で全 page 走査 (>100 thread の PR で false 0 になる事故防止)。
UNRESOLVED=0
PAGE_CURSOR=""
while :; do
  CURSOR_ARG=""
  [ -n "$PAGE_CURSOR" ] && CURSOR_ARG="-f cursor=$PAGE_CURSOR"
  PAGE=$(gh api graphql -f query='
    query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $cursor) {
            nodes {
              isResolved
              comments(first: 1) { nodes { author { login } } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" $CURSOR_ARG)
  PAGE_COUNT=$(echo "$PAGE" | jq '[.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.comments.nodes[0].author.login == "coderabbitai" or .comments.nodes[0].author.login == "coderabbitai[bot]")
    | select(.isResolved == false)] | length')
  UNRESOLVED=$((UNRESOLVED + PAGE_COUNT))
  HAS_NEXT=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
  [ "$HAS_NEXT" != "true" ] && break
  PAGE_CURSOR=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
done

# 最新 review body から actionable count (現 HEAD_SHA に対する review のみ対象、
# 古い commit の review を見て false-clear する事故を防止)
# CR body 形式 drift 対策: grep が空を返した場合は "0" にフォールバックせず
# "unknown" として扱い、後続の strict equality 判定 ([ ... = "0" ]) を false にする
# (false-clear / false auto-resolve injection の予防)
[ -z "${HEAD_SHA:-}" ] && HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq '.headRefOid')
LATEST_BODY=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  | jq --arg head "$HEAD_SHA" -r '[.[] | select(.user.login=="coderabbitai[bot]" and .commit_id==$head)] | last | .body // empty')
ACTIONABLE_LATEST=$(echo "$LATEST_BODY" | grep -oE 'Actionable comments posted:\s*[0-9]+' \
  | grep -oE '[0-9]+' | head -1)
if [ -z "$ACTIONABLE_LATEST" ]; then
  ACTIONABLE_LATEST="unknown"
  echo "WARN: ACTIONABLE_LATEST grep returned empty (CR body format drift?); treating as 'unknown' (NOT 0)" >&2
fi

# RESOLVE_INJECT_COUNT counter (per-PR + per-HEAD、最大 RESOLVE_INJECT_MAX 回まで)
# 同 HEAD で Step 7 → Step 6.5 の back jump が繰り返される場合、CR bot の thread
# processing 障害 / network drift で永久 loop に陥らないよう上限を設ける。
# counter は file-based、key に short HEAD SHA を含めることで **新 push (HEAD 変化)
# で counter が自動 reset** される (古い HEAD の counter file は別ファイルになり
# 新 HEAD は 0 から開始、push 単位で injection 上限を再付与)。
RESOLVE_COUNT_FILE="/tmp/cr-resolve-count-${PR}-$(echo "$REPO" | tr '/' '-')-${HEAD_SHA:0:8}"
RESOLVE_INJECT_MAX=3
RESOLVE_INJECT_COUNT=$(cat "$RESOLVE_COUNT_FILE" 2>/dev/null || echo 0)

if [ -x "$CR_CHAT_BIN" ] && [ "$ACTIONABLE_LATEST" = "0" ] && [ "$UNRESOLVED" -gt 0 ]; then
  if [ "$RESOLVE_INJECT_COUNT" -ge "$RESOLVE_INJECT_MAX" ]; then
    echo "WARN: Step 6.5 auto-resolve injection limit reached (count=$RESOLVE_INJECT_COUNT, max=$RESOLVE_INJECT_MAX)" >&2
    echo "      User intervention required: manually verify CR threads or escalate" >&2
    # Step 7 へ素通し (CLEAR_STRONG / SOFT は UNRESOLVED>0 のため不成立、
    # 未 clear flow で finding 反映 → fix → push の通常 round に戻る)
  else
  UNRESOLVED_BEFORE="$UNRESOLVED"
  RESOLVE_BODY=$(node "$CR_CHAT_BIN" build resolve)
  gh pr comment "$PR" --repo "$REPO" --body "$RESOLVE_BODY"
  RESOLVE_INJECT_COUNT=$((RESOLVE_INJECT_COUNT + 1))
  echo "$RESOLVE_INJECT_COUNT" > "$RESOLVE_COUNT_FILE"
  echo "Auto-issued @coderabbitai resolve (chat bucket; UNRESOLVED=$UNRESOLVED_BEFORE before, count=$RESOLVE_INJECT_COUNT/$RESOLVE_INJECT_MAX)"

  # Resolve completion verification (CR bot の thread processing を待機)
  # 30s 単位で最大 5 回 (合計 150s) wait し、UNRESOLVED が減少した時点で抜ける。
  # 5 回過ぎても変化なしなら timeout 扱いで Step 7 へ素通し
  # (CR bot 障害 / chat bucket 反映遅延の保険、後続の CLEAR_SOFT 判定で
  # UNRESOLVED が 0 にならなければ次 round で再 inject される)。
  for i in 1 2 3 4 5; do
    sleep 30
    # pagination loop で全 page 走査 (>100 thread の PR で false 0 防止)
    UNRESOLVED_NOW=0
    PAGE_CURSOR=""
    while :; do
      CURSOR_ARG=""
      [ -n "$PAGE_CURSOR" ] && CURSOR_ARG="-f cursor=$PAGE_CURSOR"
      PAGE=$(gh api graphql -f query='
        query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $pr) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  isResolved
                  comments(first: 1) { nodes { author { login } } }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" $CURSOR_ARG)
      PAGE_COUNT=$(echo "$PAGE" | jq '[.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.comments.nodes[0].author.login == "coderabbitai" or .comments.nodes[0].author.login == "coderabbitai[bot]")
        | select(.isResolved == false)] | length')
      UNRESOLVED_NOW=$((UNRESOLVED_NOW + PAGE_COUNT))
      HAS_NEXT=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
      [ "$HAS_NEXT" != "true" ] && break
      PAGE_CURSOR=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
    done
    if [ "$UNRESOLVED_NOW" -lt "$UNRESOLVED_BEFORE" ]; then
      echo "Resolve confirmed (UNRESOLVED: $UNRESOLVED_BEFORE → $UNRESOLVED_NOW)"
      break
    fi
  done
  # Step 7 を再実行 (UNRESOLVED 再 query で 0 になることを期待)
  fi  # close else (RESOLVE_INJECT_COUNT < max)
fi
```

#### 6.5.1 適用条件 (3 件 AND)

- `ACTIONABLE_LATEST=0` (latest review body): fix 漏れがない
- `UNRESOLVED > 0`: CR thread が resolve されていない
- `cr-chat` binary が available (Step 2.6.1 の解決 3 段 fallback で取得)

いずれか 1 つでも欠けると skip。run-time error にせず、Step 7 へ素通しする
(`cr-chat` 不在は plugin install 不全の signal だが本 step は best-effort)。

#### 6.5.2 verification loop の必要性

CR の `@coderabbitai resolve` chat command は bot 内部の thread processing
queue を経由するため、送信直後の `gh api graphql` 再 query では古い state が
返ることがある。30s × 5 = 最大 150s の verification loop で UNRESOLVED の
減少を確認することで、Step 7 が誤って "stale UNRESOLVED" 値で CLEAR_SOFT を
否定する false-negative を防ぐ。loop timeout 後も変化なしの場合は次 round で
Step 6.5 が再 inject されるため、永久 loop にはならない。

### Step 7. 2-stage Clear judgment (Stop polling / Merge ready 分離)

CodeRabbit は per-commit lifecycle の **commit_status** (`pending` → `success`
"Review completed") を発行することが LIVE 観測されている。これを **Stop polling**
(新 review 待ちを止めてよいか) の primary signal として使い、**Merge ready**
(実 merge してよいか) の判定とは明確に分離する。

> **重要**: 本 Step は Step 3 background watch から `STOP_POLLING_REACHED` /
> `REVIEW_ARRIVED_FALLBACK` の signal で起動されるが、判定に使う各値
> (`CR_STATUS_STATE` / `CR_STATE` / `LATEST_BODY` / `UNRESOLVED` /
> `RECENT_BLOCKER`) は **本 Step で fresh に query する** (Step 3 の cache を
> 流用しない)。background process の race condition / 古い state を避けるため。

#### 7.A Stop polling 判定 (新 review 待ちを止めてよいか)

```bash
# 明示初期化: 手動実行時 (Step 3 background watch 未経由) の inherited
# environment 汚染を避けるため、本 step で必ず false から始める
STOP_POLLING=false

HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq '.headRefOid')
CR_STATUS=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/status" \
  --jq '[.statuses[] | select(.context | test("CodeRabbit"; "i"))] | first')
CR_STATUS_STATE=$(echo "$CR_STATUS" | jq -r '.state // empty')
CR_STATUS_DESC=$(echo "$CR_STATUS"  | jq -r '.description // empty')

if [ "$CR_STATUS_STATE" = "success" ] \
   && echo "$CR_STATUS_DESC" | grep -qiE 'review completed|review complete'; then
  STOP_POLLING=true
fi
```

`STOP_POLLING=true` で初めて Step 7.B (Merge ready) の判定に進める。
`false` の場合は Step 3 polling に戻る (本 skill が CR の per-commit
review lifecycle を信頼することで、無駄な review-count polling を避ける)。

**手動実行時 (Step 3 background watch 未経由) の挙動**: Step 7 を独立に
呼び出した場合 (e.g. Step 6 の commit_status fetch 失敗で Step 3 を skip した
recovery flow)、本 7.A の bash block は Step 3 状態に依存せず fresh query で
判定する。CR commit_status が `success` でないなら `STOP_POLLING=false` →
matrix の "Stop polling 未成立" 行 (Step 3 polling 継続) に落ちる。手動 caller
は Step 3 の background watch を起動するか、後の刻みで再実行する。

#### 7.B Merge ready 判定 (実 merge してよいか、4 signal AND)

##### 7.B.1 最強シグナル: APPROVED state

`request_changes_workflow: true` (本 repo の `.coderabbit.yaml` で宣言済) のとき、
unresolved comments 0 + `pre_merge_checks` pass で CR が `state: APPROVED` の
review を自動発火する (公式 changelog: request-changes-workflow)。

```bash
CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  | jq --arg head "$HEAD_SHA" -r '[.[] | select(.user.login=="coderabbitai[bot]" and .commit_id==$head)] | last | .state // empty')
APPROVED=false
[ "$CR_STATE" = "APPROVED" ] && APPROVED=true
```

##### 7.B.2 actionable=0 (latest review body for THIS HEAD)

```bash
LATEST_BODY=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  | jq --arg head "$HEAD_SHA" -r '[.[] | select(.user.login=="coderabbitai[bot]" and .commit_id==$head)] | last | .body // empty')
ACTIONABLE=$(echo "$LATEST_BODY" | grep -oE 'Actionable comments posted:\s*[0-9]+' \
  | grep -oE '[0-9]+' | head -1)
# CR body 形式 drift 対策: grep が空を返した場合は "0" にフォールバックせず
# "unknown" として扱い、CLEAR_STRONG / CLEAR_SOFT を成立させない (false-clear 予防)
if [ -z "$ACTIONABLE" ]; then
  ACTIONABLE="unknown"
  echo "WARN: ACTIONABLE grep returned empty (CR body format drift?); treating as 'unknown' (NOT 0)" >&2
fi
```

##### 7.B.3 unresolved CR threads = 0

`reviewThreads` は GraphQL 側で 1 page 100 thread 上限のため、pagination loop
で全 page 走査する (>100 thread の PR で false 0 になる事故を防止)。

```bash
UNRESOLVED=0
PAGE_CURSOR=""
while :; do
  CURSOR_ARG=""
  [ -n "$PAGE_CURSOR" ] && CURSOR_ARG="-f cursor=$PAGE_CURSOR"
  PAGE=$(gh api graphql -f query='
    query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $cursor) {
            nodes {
              isResolved
              comments(first: 1) { nodes { author { login } } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" $CURSOR_ARG)
  PAGE_COUNT=$(echo "$PAGE" | jq '[.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.comments.nodes[0].author.login == "coderabbitai" or .comments.nodes[0].author.login == "coderabbitai[bot]")
    | select(.isResolved == false)] | length')
  UNRESOLVED=$((UNRESOLVED + PAGE_COUNT))
  HAS_NEXT=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
  [ "$HAS_NEXT" != "true" ] && break
  PAGE_CURSOR=$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
done
```

##### 7.B.4 blocker (rate-limit / paused) 不在

```bash
RECENT_BLOCKER=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\" or .author.login == \"coderabbitai[bot]\")
    | select(.body | contains(\"rate limited\") or contains(\"Reviews paused\"))] | last | .createdAt // empty")
BLOCKER=false
if [ -n "$RECENT_BLOCKER" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$RECENT_BLOCKER" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$RECENT_BLOCKER" +%s) ))
  [ "$ELAPSED" -lt 900 ] && BLOCKER=true
fi
```

##### 7.B.5 判定マトリクス (Stop polling 成立後の Merge ready 4 signal AND)

| STOP_POLLING | APPROVED | ACTIONABLE | UNRESOLVED | BLOCKER | 結果 |
|---|---|---|---|---|---|
| ✅ | ✅ | 0 | — | 不在 | **CLEAR_STRONG** (APPROVED 確定) → Step 8 |
| ✅ | — | 0 | 0 | 不在 | **CLEAR_SOFT** → Step 8 (APPROVED でない旨 user 通知) |
| ✅ | — | >0 | — | 不在 | **未 fix** → Step 4 (parse) → Step 5 (apply fixes) → Step 6 (commit + push) → Step 3 (再 watch) → Step 7 (再判定) |
| ✅ | — | 0 | >0 | 不在 | **resolve 必要** → Step 6.5 で `@coderabbitai resolve` auto-issue + verification loop → Step 7 (再判定) |
| ❌ | — | — | — | — | **Stop polling 未成立** → Step 3 polling 継続 (background watch を継続) |
| — | — | — | — | active | **blocker 中** → cooldown 待機 or `/pseudo-coderabbit-loop` 切替 |

```bash
CLEAR_STRONG=false
CLEAR_SOFT=false

if [ "$STOP_POLLING" = "true" ] \
   && [ "$APPROVED" = "true" ] \
   && [ "$ACTIONABLE" = "0" ] \
   && [ "$BLOCKER" = "false" ]; then
  CLEAR_STRONG=true
fi
# CLEAR_SOFT は CLEAR_STRONG 不成立時のみ評価 (排他化)
# CLEAR_STRONG=true は CLEAR_SOFT 条件を包含する (APPROVED 自動発火の前提が
# unresolved=0 + pre_merge_checks pass であるため、CLEAR_STRONG が true なら
# CLEAR_SOFT も論理上 true になる。両 flag を立てると下流の Step 8 routing が
# 二重発火するため、CLEAR_STRONG 優先で排他)
if [ "$CLEAR_STRONG" != "true" ] \
   && [ "$STOP_POLLING" = "true" ] \
   && [ "$ACTIONABLE" = "0" ] \
   && [ "$UNRESOLVED" = "0" ] \
   && [ "$BLOCKER" = "false" ]; then
  CLEAR_SOFT=true
fi
```

> **排他化の根拠**: 上記 bash により `CLEAR_STRONG=true` の行は **CLEAR_SOFT
> を立てない**。下流 (Step 8 / caller skill) は `if CLEAR_STRONG; then ...
> elif CLEAR_SOFT; then ...` で routing する設計を前提とする。matrix の
> 1 行目 (CLEAR_STRONG) と 2 行目 (CLEAR_SOFT) は **物理的に排他** (両方が
> 同時に成立する状態は bash code レベルで排除される)。

#### 7.C 依存しないシグナル (DO NOT USE)

以下は CodeRabbit 公式 docs で確認できない、または不安定なため本 skill では使わない:

- `gh pr checks` の `CodeRabbit` check 名（安定しない）
- `"approved by coderabbit.ai"` HTML marker（非公式）
- `"LGTM"` / `"No further actionable"` テンプレート文言（現行 public docs 未確認）

### Step 8. Final polish

Remove AI-shaped noise that would not survive a careful human reviewer:

- Unnecessary comments
- Overly defensive `try` / `catch` that masks real errors
- Formatting drifts

```bash
git diff main..HEAD --name-only
```

If cleanup produces a diff, commit + push + return to Step 3 once more.

### Step 9. Final report

```
## CodeRabbit final status

| Phase             | Status |
|-------------------|--------|
| Review handling   | ✅ |
| AI-slop removal   | ✅ |
| Final review      | ✅ |

Result: all phases complete.
```

## Done criteria

- Latest CodeRabbit review `state == APPROVED` OR unresolved bot threads == 0
- No active `rate limited` / `Reviews paused` marker (within last 15 min)
- Latest review: **Actionable = 0**, **Nitpick = 0** (profile-adjusted)
- AI-slop removal pass done
- Final review pass clear
- User notified

## 関連スキル

- `/pseudo-coderabbit-loop` — Codex 疑似 CodeRabbit で内部ループを回して rate limit を回避。push 前品質担保 / rate-limited 中の代替レビュー / Codex × CodeRabbit 反復ループに使う
- `coderabbit-mimic` agent — 疑似 CodeRabbit の実装、Codex CLI に CodeRabbit 風プロンプトを投げる read-only agent
- `/codex-team` — Codex を team member として呼ぶ基本スキル
