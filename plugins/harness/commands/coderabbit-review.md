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
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
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
  CMD="$1"
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
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
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

### Step 3. Background watch

Run in background (`run_in_background: true`, `timeout: 600000`):

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
PR=<pr-number>
INITIAL=$(gh api repos/${REPO}/pulls/${PR}/reviews \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
for i in $(seq 1 20); do
  CURRENT=$(gh api repos/${REPO}/pulls/${PR}/reviews \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
  if [ "$CURRENT" -gt "$INITIAL" ] 2>/dev/null; then
    # Desktop notification (macOS / Linux)
    osascript -e "display notification \"CodeRabbit review arrived — PR #${PR}\" with title \"Claude Code\" sound name \"Glass\"" 2>/dev/null \
      || notify-send "Claude Code" "CodeRabbit review arrived — PR #${PR}" 2>/dev/null || true
    echo "REVIEW_ARRIVED"
    exit 0
  fi
  # NOTE: `gh pr checks` の CodeRabbit check 名は unstable (Step 7.5 参照) のため、
  # ここでは REVIEW_CLEAR を短絡判定しない。Clear 判定は Step 7 の 3 段判定
  # (APPROVED / unresolved=0 / rate-limit marker 不在) に一本化する。
  # 監視ループの責務は「新 review 到着の検出」のみ。
  sleep 30
done
echo "TIMEOUT"
```

Tell the user: *"Watching in the background (up to 10 min). You can
keep working — a notification will fire when the review arrives."*

Background result routing:

- `REVIEW_ARRIVED` → Step 4 (parse the review) → Step 7 (Clear 3 段判定)
- `TIMEOUT`        → report, suggest re-running the skill (Clear 判定は Step 7 が行う)

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

### Step 7. Confirm the review is clear (STRENGTHENED)

CodeRabbit は「クリア」を明示しない傾向にある (Codex 公式 docs 調査済)。以下 3 つのシグナルで **明示的に clear 判定**:

#### 7.1 最強シグナル: `reviews[-1].state == APPROVED`

`request_changes_workflow: true` (default) のとき、unresolved comments 0 + pre-merge checks OK で自動 `APPROVED` に遷移する。

```bash
CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .state // empty')

if [ "$CR_STATE" = "APPROVED" ]; then
  CLEAR=true
fi
```

#### 7.2 中シグナル: unresolved CodeRabbit thread == 0

APPROVED にならない (例: `request_changes_workflow: false` 設定) 場合、未解決 thread 数で判定。

```bash
UNRESOLVED=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $pr: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 1) { nodes { author { login } } }
          }
        }
      }
    }
  }' -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$PR" \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.comments.nodes[0].author.login == "coderabbitai")
    | select(.isResolved == false)] | length')

[ "$UNRESOLVED" = "0" ] && CLEAR_SOFT=true
```

#### 7.3 阻害要因の否定: rate-limited / paused marker なし

```bash
# 最新 CodeRabbit コメントに rate-limited / paused marker が残っていないこと
RECENT_BLOCKER=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
    | select(.body | contains(\"rate limited\") or contains(\"Reviews paused\"))] | last | .createdAt // empty")
if [ -n "$RECENT_BLOCKER" ]; then
  ELAPSED=$(( $(date -u +%s) - $(date -u -d "$RECENT_BLOCKER" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$RECENT_BLOCKER" +%s) ))
  if [ "$ELAPSED" -lt 900 ]; then
    # 15 分以内なら blocker active、clear 判定不可
    CLEAR=false
    CLEAR_SOFT=false
  fi
fi
```

#### 7.4 判定マトリクス

| CLEAR (strong) | CLEAR_SOFT | blocker | 結果 |
|---|---|---|---|
| true | — | — | **完全 clear** → Step 8 |
| — | true | false | **ソフト clear** → Step 8 (ユーザーに APPROVED でない旨通知) |
| false | false | — | **未 clear** → Step 4 に戻って finding 再対応 |
| — | — | true | **blocker 中** → `/pseudo-coderabbit-loop` に切替提案、または cooldown 待機 |

#### 7.5 依存しないシグナル (DO NOT USE)

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
