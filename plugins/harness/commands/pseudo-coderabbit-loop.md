---
name: pseudo-coderabbit-loop
description: "Codex による疑似 CodeRabbit レビューを内部ループで回し、本物 CodeRabbit へは絞り込んだ状態で push する統合スキル。CodeRabbit の rate limit (Pro: 5/h) を回避しつつレビュー品質を維持する。Use after implementing a feature, before requesting real CodeRabbit review, especially in parallel worktree workflows. Also used to resume a loop when CodeRabbit is rate-limited."
description-ja: "Codex による疑似 CodeRabbit レビューを内部ループで実行し、本物 CodeRabbit には絞り込んだ状態で渡す統合スキル。"
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput"]
argument-hint: "[pr-number|local|profile|worktree|max-codex-parallel|no-cache]"
---

# `/pseudo-coderabbit-loop` — Codex 疑似 CodeRabbit → 本物 CodeRabbit の反復ループ

**目的**: CodeRabbit の rate limit (Pro プラン 5 PR reviews/hour、5 件/時) に縛られずにレビュー品質を確保する。Codex を「CodeRabbit の疑似 reviewer」として動員し、push 前に内部 loop で指摘を刈り取り、CodeRabbit には仕上がった状態だけを投げる。

**本スキルの価値**:
1. **Rate limit 耐性**: Codex pseudo review は hourly 制限なし、worktree 並列開発でも止まらない
2. **Clear 状態の明示判定**: `reviews[].state == APPROVED` + unresolved thread 0 + rate-limit marker 不在を組み合わせて「CodeRabbit がクリアした」を確定判定（本家 CodeRabbit はクリアを明示しない傾向）
3. **Codex を CodeRabbit に近づける**: CodeRabbit 公式 profile (`chill` / `assertive`) に加えて `strict` を harness-local 拡張として提供 (詳細下記)。Review types (`potential_issue` / `refactor_suggestion` / `nitpick`) と Severity (`critical` / `major` / `minor` / `trivial` / `info`) の公式 taxonomy に忠実
4. **worktree 並列開発対応**: `--worktree=<path>` で任意 worktree 内で実行可能

### Profile values の出所

- `chill` / `assertive` — **CodeRabbit 公式 profile** (https://docs.coderabbit.ai/reference/configuration、`reviews.profile` の定義値は 2026-04 時点でこの 2 つのみ)
- `strict` — **harness-local extension**。CodeRabbit 公式には存在せず、本 Codex 疑似 reviewer だけが理解する拡張モード。nitpick まで拾い、上限を 10 件まで広げる。`.coderabbit.yaml` に `profile: strict` を書いても **本物 CodeRabbit 側は無視する** (未知値として chill に fallback されるか error の可能性がある)。ローカル厳格レビューを望むときだけ `--profile=strict` で利用すること。

---

## Modes

| Mode | 起動引数 | 用途 |
|---|---|---|
| `pre-push` | `--local` | push 前に Codex で内部レビュー → clean なら user に push 指示 |
| `rate-limited` | `<pr-number>` (CodeRabbit marker 検知時) | CodeRabbit が rate-limited 中に Codex で代替レビュー → 復帰後に本物レビュー |
| `full-loop` | `<pr-number>` (既存 PR) | 本物 CodeRabbit の前後に Codex pseudo review を挟む full cycle |

引数なしで起動された場合は `--local` (pre-push mode) として扱う。

---

## Arguments

```
/pseudo-coderabbit-loop [pr-number|--local] [--profile=...] [--worktree=...]
```

- `pr-number`: 既存 PR 番号 (例: `8`)。`--local` なら未 push 状態を対象
- `--profile=chill|assertive|strict`: Codex に適用する profile (未指定なら `.coderabbit.yaml` の `reviews.profile` を読む、fallback は `chill`)
- `--worktree=<path>`: 対象の worktree 絶対パス (未指定なら `git rev-parse --show-toplevel` の結果)
- `--max-codex-parallel=N` (default 1, integer >= 1): **本 skill 内では現状 no-op**。本 skill は Step 2 で `coderabbit-mimic` agent を 1 個だけ spawn するため、複数 Codex を同時に走らせる経路はない。実際の Codex 並列度制御は `/parallel-worktree` Phase 4 (各 worker の `node codex-companion.mjs task` 呼出) で `scripts/codex-semaphore.sh` 経由で発火する。本 skill が flag を受け取るのは将来 multi-spawn 設計 (例: 同 PR 内 stage 1 軽量 + stage 2 詳細の並列、または 1 PR を chunk 化して coderabbit-mimic を複数 spawn する設計) に備えた**先取り argv 接点**としての位置付けで、現時点で値を渡しても動作は変わらない。誤解を避けるためこの no-op 性は本 spec で明示する
- `--no-cache`: Step 1.5 の diff fingerprint cache を bypass し、必ず `coderabbit-mimic` agent で再 review する。`.coderabbit.yaml` を編集したが path_instructions_hash が同じになる semantic-only 変更 (例: 既存ルールに別表記を加える等) で再 review を強制したいときに使う。通常は cache の deterministic key (diff + profile + yaml + path_instructions_hash) で十分なため明示指定不要

---

## 前提 (harness.config.json 推奨設定)

```json
{
  "codeRabbit": {
    "botLogin": "coderabbitai",
    "ratelimitCheckWindowMinutes": 15,
    "approvedStateAsClear": true,
    "maxPseudoLoopIterations": 5,
    "analyzerTimeoutSeconds": 120
  }
}
```

設定がなくてもデフォルト値で動く。プロジェクト固有の閾値調整に使う。

---

## Workflow

### Step 0. コンテキスト確定

```bash
# Anthropic 公式 slash command の動的置換 $ARGUMENTS を argv 配列に読み込んで parse。
# `for tok in $ARGUMENTS` だと bash の word splitting が IFS 依存で fragile になるため、
# `read -r -a TOKENS` で配列化してから `for tok in "${TOKENS[@]}"` で quote 保持展開する。
# 制限: `--worktree="my dir"` のように空白を含む値は shell の事前分割で壊れるため未サポート。
#
# Shell 互換 (bash 必須): `read -r -a` / case / 配列は bash 拡張。zsh / dash / POSIX sh では
# silent degrade するため BASH_VERSION を明示確認して fail-fast。Claude Code の Bash tool は
# 通常 /bin/bash で実行されるため本 guard は保険。
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: /pseudo-coderabbit-loop argv parser requires bash (BASH_VERSION unset)." >&2
  echo "       手動実行時は 'bash -c \"/pseudo-coderabbit-loop ...\"' で包んでください。" >&2
  exit 1
fi
# zsh で呼ばれた場合の最後の保険 (既に上の check で停止済のはず)。
[ -n "${ZSH_VERSION:-}" ] && emulate -L bash
read -r -a TOKENS <<< "$ARGUMENTS"
CLI_PROFILE=""
CLI_WORKTREE=""
CLI_LOCAL=""
CLI_PR=""
CLI_MAX_CODEX_PARALLEL=""
CLI_NO_CACHE=""
for tok in "${TOKENS[@]}"; do
  case "$tok" in
    --profile=chill|--profile=assertive|--profile=strict)
      CLI_PROFILE="${tok#--profile=}"
      ;;
    --profile=*)
      echo "WARN: invalid --profile='${tok#--profile=}' (must be chill|assertive|strict); ignored" >&2
      ;;
    --worktree=*)
      CLI_WORKTREE="${tok#--worktree=}"
      ;;
    --max-codex-parallel=*)
      v="${tok#--max-codex-parallel=}"
      # 整数 >= 1 強制 (codex-semaphore.sh acquire は max=0 を許容しないため、
      # ここで早期 fail させて runtime のわかりにくい error を避ける)。
      if [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 1 ]; then
        CLI_MAX_CODEX_PARALLEL="$v"
      else
        echo "ERROR: --max-codex-parallel must be integer >= 1 (got '$v')" >&2
        exit 1
      fi
      ;;
    --no-cache)
      CLI_NO_CACHE="yes"
      ;;
    --local)
      CLI_LOCAL="yes"
      ;;
    *)
      # positional PR 番号は「全桁が数字」のみ受理 (`42abc` などが gh api /pulls/${PR} に
      # 渡ると 404 になるため、厳密化)。bash `[[ =~ ]]` で完全数字マッチ。
      if [[ "$tok" =~ ^[0-9]+$ ]]; then
        CLI_PR="$tok"
      fi
      ;;
  esac
done
# default 1 (sequential、subagent context overflow 防止の安全側 default)。
# CLI > env の precedence (caller が明示なら勝つ、未指定なら inherited env or 1)。
MAX_CODEX_PARALLEL="${CLI_MAX_CODEX_PARALLEL:-${MAX_CODEX_PARALLEL:-1}}"

WORKTREE="${CLI_WORKTREE:-${WORKTREE:-$(git rev-parse --show-toplevel)}}"
cd "$WORKTREE"
HEAD_BRANCH=$(git branch --show-current)

# BASE_BRANCH fallback:
# `git config ... | sed ... || echo main` では sed が exit 0 で返すため `||` が発火せず
# BASE_BRANCH が空文字になる (開発過程で判明した sed exit 0 の silent fallback 失敗)。別段で取得 + `:-main` 空チェックで確実に既定値を入れる。
RAW_MERGE=$(git config --get "branch.${HEAD_BRANCH}.merge" 2>/dev/null || true)
BASE_BRANCH="${RAW_MERGE#refs/heads/}"
BASE_BRANCH="${BASE_BRANCH:-main}"

# PR number を CLI_PR から反映 (開発過程で判明した PR 引数反映不全): CLI_PR > 既存 PR env
PR="${CLI_PR:-$PR}"

# Mode 判定: --local 明示 or PR 未指定なら local mode で GitHub API を使わない (開発過程で判明した --local flag 未配線問題)。
if [ -n "$CLI_LOCAL" ] || [ -z "$PR" ]; then
  MODE="local"
  REPO=""
  echo "Mode: local (--local flag or no PR number); GitHub API disabled"
else
  MODE="pr"
  REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
  echo "Mode: pr (PR=$PR REPO=$REPO)"
fi

# PROFILE resolver — precedence chain (高優先 → 低優先):
#   1. CLI_PROFILE  — `--profile=<value>` flag (CLI 経由は strict 含めて allowlist)
#   2. ENV_PROFILE  — env `HARNESS_CR_PROFILE` (harness-local extension、strict 許容)
#   3. CFG_PROFILE  — `harness.config.json.tddEnforce.pseudoCoderabbitProfile` (loadConfig validated 済、strict 許容)
#   4. YAML_PROFILE — `.coderabbit.yaml.reviews.profile` (CodeRabbit 公式 schema、chill/assertive のみ、strict は WARN+fallthrough)
#   5. default      — `chill`
#
# 設計参照: `core/src/work/profile-resolver.ts` (同一 precedence の TS pure function、
# 単体 test は `core/src/__tests__/profile-resolver.test.ts`)。本 bash 実装は
# 同 chain を skill 起動 1 回分の per-invocation 解決として再現する。
#
# 各 source が invalid 値の場合は WARN を stderr に emit して次 source へ fallthrough
# (silent に chill に落とさず、assertive/strict が設定された repo で cooldown/上限が
# 縮退する事故を検知可能にする)。

# 2. ENV_PROFILE — env HARNESS_CR_PROFILE
ENV_PROFILE_RAW="${HARNESS_CR_PROFILE:-}"
# trim leading / trailing whitespace (bash parameter expansion)
ENV_PROFILE_RAW="${ENV_PROFILE_RAW#"${ENV_PROFILE_RAW%%[![:space:]]*}"}"
ENV_PROFILE_RAW="${ENV_PROFILE_RAW%"${ENV_PROFILE_RAW##*[![:space:]]}"}"
ENV_PROFILE=""
if [ -n "$ENV_PROFILE_RAW" ]; then
  case "$ENV_PROFILE_RAW" in
    chill|assertive|strict)
      ENV_PROFILE="$ENV_PROFILE_RAW"
      ;;
    *)
      echo "WARN: env HARNESS_CR_PROFILE='$ENV_PROFILE_RAW' is invalid (must be chill|assertive|strict); falling through" >&2
      ;;
  esac
fi

# 3. CFG_PROFILE — harness.config.json.tddEnforce.pseudoCoderabbitProfile
# loadConfig が validate 済の前提だが、bash 経路で raw JSON を直接読むため
# defensive check + 失敗経路の透明化を併設する。
#
# 過去の silent fallthrough bug への対応 (Codex G7 Major):
#   - jq 不在時 → これまで silent で chill に倒れていた → harness.config.json で
#     strict/assertive を強制したつもりが効かない事故が発生 → WARN を必ず出す
#   - jq exit != 0 (malformed JSON 等) → 同様に silent fallthrough → 明示 WARN
#   - jq stderr 出力 → /dev/null に捨てず一旦 capture して内容で fallthrough or 警告
CFG_PROFILE=""
if [ -f harness.config.json ]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "WARN: harness.config.json exists but jq is not installed; CFG_PROFILE source will be skipped (use env HARNESS_CR_PROFILE or --profile flag instead)" >&2
  else
    JQ_STDERR=$(mktemp)
    CFG_PROFILE_RAW=$(jq -r '.tddEnforce.pseudoCoderabbitProfile // ""' harness.config.json 2>"$JQ_STDERR")
    JQ_EXIT=$?
    if [ "$JQ_EXIT" -ne 0 ]; then
      JQ_ERR_MSG=$(tr '\n' ' ' < "$JQ_STDERR" | head -c 300)
      echo "WARN: jq failed to parse harness.config.json (exit=$JQ_EXIT, stderr='$JQ_ERR_MSG'); CFG_PROFILE source skipped (config 修復推奨)" >&2
      CFG_PROFILE_RAW=""
    fi
    rm -f "$JQ_STDERR"
    case "$CFG_PROFILE_RAW" in
      chill|assertive|strict)
        CFG_PROFILE="$CFG_PROFILE_RAW"
        ;;
      "")
        ;;
      *)
        echo "WARN: harness.config.json tddEnforce.pseudoCoderabbitProfile='$CFG_PROFILE_RAW' is invalid; falling through" >&2
        ;;
    esac
  fi
fi

# 4. YAML_PROFILE — .coderabbit.yaml から profile を取得 (3 段フォールバック)
#   a. yq (最も信頼性が高い YAML parser、存在すれば優先)
#   b. python3 + PyYAML (pip 導入済なら高精度)
#   c. python3 stdlib 限定の正規表現 (reviews: block 配下の profile: を素朴に抽出)
PROFILE=""
if [ -f .coderabbit.yaml ]; then
  if command -v yq >/dev/null 2>&1; then
    # `yq -r` を強制 (raw output) + xargs で whitespace 正規化。
    # mike-farah/yq (Go 製) は default raw、kislyuk/yq (Python wrapper) は quote-wrap
    # する場合がある。`-r` flag を両 implementations 共通で raw 化、xargs で trim。
    # 過去 silent fallthrough bug (Codex G7 Major): kislyuk yq から `'assertive'`
    # (quote 付き) が返ると後続の case match が外れて default に倒れていた。
    PROFILE=$(yq -r '.reviews.profile // ""' .coderabbit.yaml 2>/dev/null | xargs || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    PROFILE=$(python3 -c "
import yaml
d = yaml.safe_load(open('.coderabbit.yaml'))
print(d.get('reviews', {}).get('profile', '') if isinstance(d, dict) else '')
" 2>/dev/null || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    # stdlib 限定: reviews: 直下のインデントに一致する profile: のみ許可。
    # 深い階層 (reviews.labels.profile 等) を誤読しないよう first_indent で制約。
    # 値の後続は inline YAML comment `# ...` を許容し、`profile: assertive  # note` を拾える。
    # quoted heredoc `<<'PYEOF'` で bash エスケープ依存を排除 (quoted heredoc への移行)。
    PROFILE=$(python3 <<'PYEOF' 2>/dev/null || true
import re
try:
    text = open('.coderabbit.yaml').read()
    m = re.search(r'^reviews\s*:\s*\n((?:[ \t]+.*\n?)+)', text, re.MULTILINE)
    if m:
        block = m.group(1)
        first_indent = re.match(r'^([ \t]+)', block)
        if first_indent:
            indent = first_indent.group(1)
            pattern = r'^' + re.escape(indent) + r'profile\s*:\s*["\']?(\w+)["\']?(?:\s+#.*)?\s*$'
            p = re.search(pattern, block, re.MULTILINE)
            if p:
                print(p.group(1))
except Exception:
    pass
PYEOF
)
  fi
  if [ -z "$PROFILE" ]; then
    echo "WARN: .coderabbit.yaml exists but profile could not be parsed (yq / PyYAML / stdlib regex all failed). Falling back to 'chill'." >&2
    PROFILE="chill"
  fi
else
  PROFILE="chill"
fi

# YAML 由来 profile は CodeRabbit 公式 allowlist (chill / assertive) のみ許可。
# strict は harness-local extension のため YAML 経路では採用せず、WARN + 次 source へ fallthrough。
# (公式 schema: https://docs.coderabbit.ai/reference/configuration は 2026-04 時点で
# reviews.profile = chill | assertive のみ)
YAML_PROFILE=""
if [ -n "$PROFILE" ]; then
  case "$PROFILE" in
    chill|assertive)
      YAML_PROFILE="$PROFILE"
      ;;
    *)
      echo "WARN: .coderabbit.yaml profile='$PROFILE' is outside CodeRabbit official allowlist (chill / assertive); falling through (use --profile=strict on the command line, env HARNESS_CR_PROFILE=strict, or harness.config.json tddEnforce.pseudoCoderabbitProfile=strict for the harness-local extension)" >&2
      ;;
  esac
fi

# 5. Final resolution — precedence chain CLI > ENV > CFG > YAML > default
#
# 設計参照: `core/src/work/profile-resolver.ts` (同一 precedence の TS pure function、
# 単体 test は `core/src/__tests__/profile-resolver.test.ts`)。
PROFILE_SOURCE=""
if [ -n "$CLI_PROFILE" ]; then
  PROFILE="$CLI_PROFILE"
  PROFILE_SOURCE="cli"
elif [ -n "$ENV_PROFILE" ]; then
  PROFILE="$ENV_PROFILE"
  PROFILE_SOURCE="env"
elif [ -n "$CFG_PROFILE" ]; then
  PROFILE="$CFG_PROFILE"
  PROFILE_SOURCE="harness-config"
elif [ -n "$YAML_PROFILE" ]; then
  PROFILE="$YAML_PROFILE"
  PROFILE_SOURCE="coderabbit-yaml"
else
  PROFILE="chill"
  PROFILE_SOURCE="default"
fi
echo "Resolved profile: $PROFILE (source=$PROFILE_SOURCE; precedence: CLI > env > harness.config.json > .coderabbit.yaml > default)"
```

### Step 1. CodeRabbit 状態確認（PR mode のみ）

PR 番号が渡された場合、まず CodeRabbit 側の状態を取得。

**このセクション (Step 1 全体) は PR mode (`MODE="pr"`) 専用**。`MODE="local"` の場合は Step 2 へ直接進み、`gh` 呼出は一切行わない (GitHub API off-load、offline 環境対応)。

#### 1.1 Clear 判定（3 段階）

以下のコードブロックは `if [ "$MODE" = "pr" ]; then ... fi` で gate されている前提で書かれている。`MODE="local"` では skip される。

```bash
if [ "$MODE" = "pr" ]; then
# 最強シグナル: reviews[-1].state == APPROVED
CR_STATE=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
  --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .state // empty')
[ "$CR_STATE" = "APPROVED" ] && CLEAR_STRONG=true

# 中シグナル: unresolved CodeRabbit threads == 0
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

# Rate limit marker 検出（妨害要因）
RATE_LIMIT_ACTIVE=$(gh pr view "$PR" --repo "$REPO" --json comments \
  --jq "[.comments[] | select(.author.login == \"coderabbitai\")
         | select(.body | contains(\"rate limited by coderabbit.ai\"))] | length")
if [ "$RATE_LIMIT_ACTIVE" -gt 0 ]; then
  LATEST_RATE_LIMIT_TS=$(gh pr view "$PR" --repo "$REPO" --json comments \
    --jq "[.comments[] | select(.author.login == \"coderabbitai\")
           | select(.body | contains(\"rate limited by coderabbit.ai\"))] | last | .createdAt")
fi
fi  # end MODE=="pr" gate for Step 1.1
```

**判定**:
- `CLEAR_STRONG=true` → 完全 clear、Step 6 へ
- `CLEAR_SOFT=true AND RATE_LIMIT_ACTIVE=0` → ほぼ clear、Step 5 (final polish) へ
- `RATE_LIMIT_ACTIVE>0` かつ最新 marker から 15 分以内 → rate-limited mode に切替 (Step 2 の Codex 疑似レビューを実行)
- それ以外 → 通常の review loop へ

#### 1.2 最新レビュー取得

`APPROVED` でなく `COMMENTED` / `CHANGES_REQUESTED` が出ている場合は body を parse し、Actionable / Nitpick / Outside-diff を抽出。

```bash
if [ "$MODE" = "pr" ]; then
  LATEST_REVIEW_BODY=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | last | .body')
fi  # Step 1.2 is PR-mode only
```

### Step 1.5. Diff fingerprint cache lookup (NEW)

**目的**: 同 commit hash + 同 profile + 同 `.coderabbit.yaml` + 同 path_instructions の組合せが過去に review 済みなら、再実行を 100% skip して rate-limit / Codex token 消費を回避する。

**Cache key**: `SHA-256(diff || \0 || profile || \0 || yaml || \0 || path_instructions_hash)` (collision-safe boundary delimiter)
**Cache loc**: `<WORKTREE>/.coderabbit-cache/<fingerprint>.json`
**Eviction**: 自動なし (commit hash 変われば新 fingerprint で別ファイル、stale エントリは `--no-cache` または手動 `node bin/cr-cache invalidate` で除去)

```bash
CACHE_HIT="false"
FINDINGS_JSON=""

if [ "$CLI_NO_CACHE" != "yes" ]; then
  # CR_CACHE_BIN の解決 3 段 fallback:
  #   1. 環境変数 CR_CACHE_BIN が指定されていればそれを使う
  #   2. PATH 上に cr-cache があれば command -v で発見 (npm install -g 等)
  #   3. HARNESS_PLUGIN_ROOT/bin/cr-cache (env var、または既定の generic placeholder)
  # plugin install path はマーケットプレイス毎に異なるため、shipped spec では
  # `<your-marketplace>` を placeholder として明示する。
  if [ -z "${CR_CACHE_BIN:-}" ]; then
    CR_CACHE_BIN=$(command -v cr-cache 2>/dev/null || true)
  fi
  if [ -z "$CR_CACHE_BIN" ]; then
    HARNESS_PLUGIN_ROOT="${HARNESS_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/<your-marketplace>/plugins/harness}"
    CR_CACHE_BIN="${HARNESS_PLUGIN_ROOT}/bin/cr-cache"
  fi

  if [ ! -x "$CR_CACHE_BIN" ]; then
    echo "WARN: cr-cache binary not found at $CR_CACHE_BIN; skipping cache layer" >&2
  else
    # diff text 取得 + 失敗時の fallback:
    # silent な空文字 fallback だと false cache hit を招くため、DIFF_FAILED flag で
    # cache bypass を明示する。git diff が non-zero exit したら cache layer を skip。
    DIFF_TEXT=""
    DIFF_FAILED="false"
    if ! DIFF_TEXT=$(git diff "$BASE_BRANCH"..HEAD 2>/dev/null) || [ -z "$DIFF_TEXT" ]; then
      if ! DIFF_TEXT=$(git diff "$BASE_BRANCH" 2>/dev/null); then
        echo "WARN: git diff failed against $BASE_BRANCH; cache layer skipped to avoid false hits" >&2
        DIFF_FAILED="true"
      fi
    fi
    CRY_HASH=""
    if [ -f .coderabbit.yaml ]; then
      # POSIX shasum (macOS / BSD) と GNU sha256sum の両対応
      if command -v shasum >/dev/null 2>&1; then
        CRY_HASH=$(shasum -a 256 .coderabbit.yaml | awk '{print $1}')
      elif command -v sha256sum >/dev/null 2>&1; then
        CRY_HASH=$(sha256sum .coderabbit.yaml | awk '{print $1}')
      fi
    fi
    # path_instructions の hash は yaml に含まれているため CRY_HASH と semantic に重複する
    # が、別 field として分けて将来の path_instructions 別ファイル化 (e.g. path-rules.md)
    # に備える。現状は yaml hash と同値で OK。
    PI_HASH="$CRY_HASH"

    FINGERPRINT=""
    if [ "$DIFF_FAILED" != "true" ]; then
      FINGERPRINT=$(printf '%s' "$DIFF_TEXT" | node "$CR_CACHE_BIN" compute-fingerprint \
        --diff-stdin --profile "$PROFILE" \
        --coderabbit-yaml-hash "$CRY_HASH" \
        --path-instructions-hash "$PI_HASH" 2>/dev/null || true)
    fi

    if [ -n "$FINGERPRINT" ]; then
      # Lookup. exit 0 = hit (stdout に JSON), exit 1 = miss (stdout 空)
      CACHED=$(node "$CR_CACHE_BIN" lookup --workdir "$WORKTREE" --fingerprint "$FINGERPRINT" 2>/dev/null) && CACHE_HIT="true" || CACHE_HIT="false"
      if [ "$CACHE_HIT" = "true" ]; then
        echo "Cache hit ($FINGERPRINT) — skipping coderabbit-mimic agent invocation"
        FINDINGS_JSON="$CACHED"
      else
        echo "Cache miss ($FINGERPRINT) — running coderabbit-mimic agent"
      fi
    fi
  fi
fi
```

`CACHE_HIT="true"` のとき Step 2 (`coderabbit-mimic` agent spawn) を skip して Step 3 (Findings 対応) に進む。
`CACHE_HIT="false"` のとき通常通り Step 2 へ進み、agent return value を `FINDINGS_JSON` に格納してから Step 2 末尾の cache write hook へ。

**ROI 試算 (一般的なフィーチャーブランチでの想定)**:
- 同 PR で push 後 lint / typo 系の 1-line revert + redo: cache hit 想定 (diff 同一)
- rebase で `--force-with-lease` push: 異なる commit hash でも diff 同一なら cache hit
- 概算 30-40% の review request を skip 可能 (実装 PR で empirical 検証推奨)

### Step 2. Pseudo CR 実行 (CR CLI 直呼出 → coderabbit-mimic fallback chain)

#### Step 2.0. CR CLI 検出 (NEW、上位優先)

CodeRabbit CLI (`coderabbit` binary、`brew install --cask coderabbit` で導入) が install + auth 済の場合、**`coderabbit --agent` 直呼出**を優先する。これは CodeRabbit 公式 reviewer 自身を local で動かすため、findings の品質と再現性が高い。CLI 不在 / 未 auth の場合は従来通り `coderabbit-mimic` agent (Codex 模倣) に fallback する。

**Binary 名注意**: homebrew install 名は `coderabbit` であり `cr` ではない (よくある誤解、旧 wrapper 実装の `cr` spawn は誤りのため `coderabbit` に修正済)。本 spec は `coderabbit` binary を前提に記述する。

```bash
HARNESS_PLUGIN_ROOT="${HARNESS_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/cc-triad-relay/plugins/harness}"
CR_CLI_BIN="${HARNESS_PLUGIN_ROOT}/bin/cr-cli"
USE_CR_CLI="false"

if [ -x "$CR_CLI_BIN" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    # Codex review #3 fix: python3 不在を silent fallback すると CR CLI 不具合
    # (auth missing vs binary missing) と区別できない。明示 WARN を出して
    # coderabbit-mimic fallback に進む。
    echo "WARN: python3 not on PATH — cannot parse CR CLI detection JSON; assuming CR CLI unavailable" >&2
  else
    # stderr を完全 suppress すると診断 message が消える。tmp file に capture
    # して、失敗時のみ stderr に echo する。
    CR_DETECT_STDERR=$(mktemp -t pseudo-cr-detect-stderr-XXXXXX) 2>/dev/null || CR_DETECT_STDERR=""
    if [ -n "$CR_DETECT_STDERR" ]; then
      CR_DETECTION=$(node "$CR_CLI_BIN" detect 2>"$CR_DETECT_STDERR" || echo '{"available":false,"reason":"detect-failed"}')
    else
      CR_DETECTION=$(node "$CR_CLI_BIN" detect 2>/dev/null || echo '{"available":false,"reason":"detect-failed"}')
    fi
    CR_AVAILABLE=""
    CR_AVAILABLE=$(echo "$CR_DETECTION" | python3 -c "import sys, json; d=json.load(sys.stdin); print('true' if d.get('available') else 'false')" 2>/dev/null || true)
    if [ -z "$CR_AVAILABLE" ]; then
      echo "WARN: failed to parse CR CLI detection JSON (python3 -c failed); assuming unavailable" >&2
    elif [ "$CR_AVAILABLE" = "true" ]; then
      USE_CR_CLI="true"
      CR_VERSION=$(echo "$CR_DETECTION" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('version','unknown'))" 2>/dev/null || echo "unknown")
      echo "CR CLI detected (version=$CR_VERSION) — using direct invocation"
    else
      CR_REASON=$(echo "$CR_DETECTION" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('reason','unknown'))" 2>/dev/null || echo "unknown")
      echo "CR CLI unavailable (reason=$CR_REASON) — falling back to coderabbit-mimic agent"
      # 失敗時 (CR_AVAILABLE != "true") は capture した stderr を出力して診断補助
      if [ -n "${CR_DETECT_STDERR:-}" ] && [ -s "$CR_DETECT_STDERR" ]; then
        echo "DEBUG: cr-cli detect stderr:" >&2
        cat "$CR_DETECT_STDERR" >&2
      fi
    fi
    [ -n "${CR_DETECT_STDERR:-}" ] && rm -f "$CR_DETECT_STDERR"
  fi
fi
```

**Bucket 帰属の caveat (Codex CLI auth research 済)**: PR review と CLI review の rate-limit bucket が独立か共有かは公式 docs で **未確認**。保守的に共有 5/h 想定で運用し、CLI 直呼出時に `error.code=RATE_LIMITED` / exit 429 を検出したら同 iteration で `coderabbit-mimic` agent に automatic fallback する。

#### Step 2.0.1. CR CLI 直呼出 path (USE_CR_CLI=true)

```bash
if [ "$USE_CR_CLI" = "true" ]; then
  # NDJSON output を tmp directory に capture (Codex review #2 fix: mktemp -d
  # で macOS / GNU portability + concurrent run race 回避、trap cleanup)
  TMP_DIR=$(mktemp -d -t pseudo-cr-cli-XXXXXX)
  trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
  TMP_NDJSON="$TMP_DIR/output.ndjson"
  TMP_PARSE_LOG="$TMP_DIR/parse.log"
  CR_EXIT=0
  node "$CR_CLI_BIN" review --base "$BASE_BRANCH" --dir "$WORKTREE" \
    ${CRY_PATH:+--config "$CRY_PATH"} > "$TMP_NDJSON" 2>&1 || CR_EXIT=$?

  # rate-limit 検出 (公式 docs 04-cli-auth-ci.md: exit 429 or `error.code=RATE_LIMITED`)
  if [ "$CR_EXIT" -eq 429 ] || grep -q '"code":"RATE_LIMITED"' "$TMP_NDJSON" 2>/dev/null; then
    echo "CR CLI rate-limited — falling back to coderabbit-mimic agent for this iteration"
    USE_CR_CLI="false"
  else
    # NDJSON を findings JSON 構造に変換 (line-by-line に finding 抽出)
    # Codex review #5 fix: parse error は stderr に WARN 出力して silent failure
    # を回避。parse_errors > 0 なら caller (Step 3 finding 対応) に明示。
    # bash heredoc 内で `'$TMP_NDJSON'` は path に `'` を含むと壊れる。env var
    # 経由で os.environ 参照する safer pattern にする。
    FINDINGS_JSON=$(TMP_NDJSON="$TMP_NDJSON" python3 -c "
import json, os, sys
findings = []
parse_errors = 0
with open(os.environ['TMP_NDJSON']) as f:
    for line_no, line in enumerate(f, start=1):
        line = line.strip()
        if not line: continue
        try:
            ev = json.loads(line)
            if ev.get('type') == 'finding':
                findings.append(ev)
        except json.JSONDecodeError as e:
            parse_errors += 1
            print(f'WARN: NDJSON parse error at line {line_no}: {e}', file=sys.stderr)
print(json.dumps({'source':'cr-cli','findings':findings,'parse_errors':parse_errors}))
" 2> "$TMP_PARSE_LOG") || FINDINGS_JSON='{"source":"cr-cli","findings":[],"parse_errors":-1}'
    if [ -s "$TMP_PARSE_LOG" ]; then
      echo "WARN: NDJSON parse errors detected — see $TMP_PARSE_LOG (carbon copied to stderr below):" >&2
      cat "$TMP_PARSE_LOG" >&2
    fi
  fi
fi
```

#### Step 2.0.2. coderabbit-mimic fallback path (USE_CR_CLI=false)

`coderabbit-mimic` agent を Agent tool で呼び出し (従来パス、CLI 不在時 / rate-limited 時の fallback)。入力 (公式 tools-reference: `Agent` tool が subagent spawn 用、旧称 `Task` は現行 catalog 未掲載):

```json
{
  "repo_root": "<WORKTREE>",
  "base_branch": "<BASE_BRANCH>",
  "head_branch": "<HEAD_BRANCH>",
  "profile": "<PROFILE>",
  "path_instructions": "<.coderabbit.yaml の path_instructions 全部>",
  "project_rules_files": ["CLAUDE.md", "AGENTS.md", ".claude/rules/*.md"],
  "coderabbit_feedback": "<LATEST_REVIEW_BODY if exists else null>",
  "previous_findings_hash": "<前回の Step 2 出力ハッシュ if exists>"
}
```

返り値: findings の JSON (coderabbit-mimic の output 仕様参照)。

#### Step 2 補遺: parent subagent context 保護 (output file-redirect)

長文 findings JSON が parent subagent context を埋めて 100% timeout する事故を
防ぐため、`coderabbit-mimic` agent は内部で `harness:codex-sync` agent (codex-sync.md
Output File Redirect contract) を経由し、output file-redirect を **agent 内部で完結** させる
構成になっている。本 skill 側 (caller) では追加の marker inject は不要 (mimic
agent が `$WORKDIR/$RESULT` を自動管理する)。

```bash
# 本 skill は coderabbit-mimic agent を spawn するだけで OK。
# context overflow 回避は mimic agent 内部の Step 3 で codex-sync 経由 +
# [output-file: $RESULT] marker により担保される (agent 内 trap で WORKDIR ごと cleanup)。
# 本 skill 側で外部 TMP_RESULT を作る必要はない。
```

`--max-codex-parallel` フラグは **本 skill 内では no-op**
(CodeRabbit review clarification)。
複数 PR を並列で走らせる際の Codex 並列度上限は **caller (coordinator)
レイヤーで制御する** 責務であり、本 skill 内部の mimic agent 1 回呼出には
影響しない。本フラグは coordinator (例: `/parallel-worktree` /
`/harness-work --parallel`) が自身の dispatch ロジックで参照するための
情報フラグであって、本 skill が pass-through で受け取って Codex に伝搬する
ような実装は **意図的に持たない** (mimic agent 内部の context overflow 回避は
本 skill 内 Step 3 の output-file redirect で別レイヤーとして処理される)。

#### Step 2 補遺: Cache write hook (NEW)

`coderabbit-mimic` agent が完了して `FINDINGS_JSON` が確定した直後、cache miss だった場合は次回 run のために結果を永続化する:

```bash
if [ "$CACHE_HIT" = "false" ] && [ -n "$FINGERPRINT" ] && [ -x "$CR_CACHE_BIN" ] && [ -n "$FINDINGS_JSON" ]; then
  # FINDINGS_JSON が valid JSON か事前確認 (Codex agent return が text の可能性)
  if printf '%s' "$FINDINGS_JSON" | python3 -c "import sys, json; json.loads(sys.stdin.read())" 2>/dev/null; then
    printf '%s' "$FINDINGS_JSON" | node "$CR_CACHE_BIN" write \
      --workdir "$WORKTREE" --fingerprint "$FINGERPRINT" --stdin
    echo "Cached findings to $WORKTREE/.coderabbit-cache/$FINGERPRINT.json"
  else
    echo "WARN: agent return is not valid JSON; skipping cache write" >&2
  fi
fi
```

**Cache invalidation の判断**:
- `.coderabbit.yaml` の `reviews.profile` が変わる → fingerprint 自動的に変わる (cache miss、再 review が走る)
- `.coderabbit.yaml` の path_instructions のみ変わる → 同上 (CRY_HASH に含まれる)
- 同じ diff を別 commit hash で push (rebase 等) → `git diff` の text 同じなら fingerprint 同じ → cache hit
- 全消去したい場合: `node "$CR_CACHE_BIN" invalidate --workdir "$WORKTREE"`

#### Step 2 補遺: `.gitignore` 推奨設定

cache file は review findings 全文 (機微な repo state を含む可能性) をプレーン JSON で保存するため、**プロジェクト側 `.gitignore` に `.coderabbit-cache/` を追加することを強く推奨**:

```gitignore
# Pseudo-CodeRabbit cache (per-developer ephemeral, never commit)
.coderabbit-cache/
```

未登録のまま commit すると以下のリスクがある:
- review findings (file パス・行番号・指摘内容) が repo に永続化される
- private code review の context が public mirror に流出する可能性
- branch 切替時に古い cache が混在して誤判定の原因になる

本 skill 自身は `.gitignore` を自動編集しない (caller リポの policy を尊重)。導入時は手動追記 + commit を推奨。

#### Step 2 補遺: Codex 並列度

複数 PR を並列で本 skill から走らせる coordinator (例: `/parallel-worktree`) が
存在する場合、coordinator は `--max-codex-parallel=N` を本 skill に forward する。
本 skill は単発 spawn のため `N>=1` なら no-op だが、将来 multi-spawn 設計
(例: 同 PR 内 stage 1 軽量 + stage 2 詳細の並列) に備えて argv は配線済。
Codex semaphore 本体 (`scripts/codex-semaphore.sh`) は `parallel-worktree` worker 側で
発火する。

### Step 3. Findings 対応

#### 3.1 優先度別処理

- `actionable=true` (severity >= major or critical category of minor) → 必ず修正
- `nitpick` (profile が `assertive` または `strict` の場合) → 軽量修正 or 却下コメント。CodeRabbit 公式 `reviews.profile` は `assertive` mode で nitpick を出す動作 (https://docs.coderabbit.ai/reference/configuration)。`strict` は harness-local 拡張として nitpick 上限のみ強化する。
- `outside_diff` → 呼出元にユーザー判断を仰ぐ（diff 外変更は scope 外の可能性）

#### 3.2 修正実行

単発タスクなら direct edit、複数ならば `harness:worker` agent または `/tdd-implement` を呼び出して修正適用。

- **TDD 規約を守る**: tests 先に、実装後。
- **各修正に意味単位 commit**。HEREDOC でメッセージ記述、末尾に `Co-Authored-By` を忘れない。
- **push は modeによる**:
  - `pre-push` mode: push しない（user に最終確認してもらう）
  - `rate-limited` / `full-loop` mode: `git push` まで実施

#### 3.3 Pseudo re-review

同じ `coderabbit-mimic` agent を再実行。`previous_findings_hash` を渡して重複 suppressing。

`clear=true`（actionable 0 + profile 上限内 nitpick 0）になるまで最大 `maxPseudoLoopIterations` 回 (default 5) 反復。

### Step 4. 本物 CodeRabbit トリガー

`full-loop` / `rate-limited` mode で、pseudo review clean になった後:

```bash
# Rate limit marker から 15 分経過しているか
# GNU `date -d` / BSD `date -j -f` のどちらにも依存せず、
# python3 datetime.fromisoformat で ISO 8601 を解釈 (macOS/Linux 双方で動作)。
# python3 が不在 or parse 失敗時は silent に ELAPSED>=900 (cooldown 即時解除) へ
# 落とさず、安全側として cooldown を強制 (ELAPSED=0) する。
if [ -n "$LATEST_RATE_LIMIT_TS" ]; then
  PAST_TS=""
  if command -v python3 >/dev/null 2>&1; then
    PAST_TS=$(python3 -c '
import sys
from datetime import datetime, timezone
s = sys.argv[1]
if s.endswith("Z"):
    s = s[:-1] + "+00:00"
try:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    print(int(dt.timestamp()))
except Exception:
    pass
' "$LATEST_RATE_LIMIT_TS" 2>/dev/null || true)
  fi
  if [ -z "$PAST_TS" ] || [ "$PAST_TS" = "0" ]; then
    # python3 が command -v で見つからない / ISO8601 parse 失敗 → 保守的に full cooldown を強制
    echo "WARN: rate-limit cooldown forced (python3 unavailable or ISO8601 parse failed for '$LATEST_RATE_LIMIT_TS')" >&2
    ELAPSED=0
  else
    ELAPSED=$(( $(date -u +%s) - PAST_TS ))
  fi
  if [ "$ELAPSED" -lt 900 ]; then
    WAIT=$(( 900 - ELAPSED ))
    echo "Rate limit cooldown: wait ${WAIT}s before triggering"
    # オプション: Monitor で待機、または即手動トリガー試行
  fi
fi

# 手動レビュートリガー (rate-limited 解除後、または通常の push 後追加トリガー用)
if [ "$MODE" = "pr" ]; then
  gh pr comment "$PR" --repo "$REPO" --body "@coderabbitai review

Pseudo CodeRabbit loop (profile=${PROFILE}) が clean を確認しました。本物 CodeRabbit の最終レビューをお願いします。"
fi  # Step 4 trigger is PR-mode only
```

**注意**: 手動トリガーも rate limit bucket を消費する（Codex 調査で確認）。push 直後の自動レビューで足りる場合は skip。

### Step 5. CodeRabbit レビュー監視

`/coderabbit-review` skill を呼び出すか、内部で Monitor を使って reviews[] の count 増加を監視:

```bash
if [ "$MODE" = "pr" ]; then
  INITIAL=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
    --jq "[.[] | select(.user.login==\"coderabbitai[bot]\")] | length")
  # Monitor tool を使うか、polling loop を回して変化を検出
fi  # Step 5 polling is PR-mode only (local mode returns after pseudo loop)
```

新 review 到着 → Step 1.1 の Clear 判定を再実行。
- `CLEAR_STRONG=true` → Step 6 へ
- `COMMENTED`/`CHANGES_REQUESTED` で Actionable あり → Step 2 (pseudo review に学習 feedback として CodeRabbit body を渡す) → Step 3 → Step 4 → Step 5 へ

### Step 6. 完了報告

```
## /pseudo-coderabbit-loop 結果

| Phase | Status |
|-------|--------|
| Pseudo review iterations | N 回 |
| Real CodeRabbit reviews | M 回 |
| Final clear signal | APPROVED / unresolved=0 |
| Rate limit events | X 回検出 |

- Final commit: <sha>
- Findings resolved: <count>
- Findings rejected (with justification): <count>

Loop complete. PR is ready for human review.
```

---

## Parallel worktree 運用

複数 leaf worktree で並列開発している場合、各 worktree で独立に `/pseudo-coderabbit-loop --worktree=<path> --local` を走らせて、各 PR の push 前品質を担保する。`--local` なら GitHub API を叩かないので完全オフライン実行が可能。

push 後は `/pseudo-coderabbit-loop <pr-number> --worktree=<path>` に切り替え、本物 CodeRabbit の rate limit を考慮しながら loop を回す。

---

## CodeRabbit が「クリア」を明示しない問題への対応

CodeRabbit は Actionable 0 + Nitpick 0 の review body で「approved」や「LGTM」を必ず出すわけではない (Codex 調査で確認)。本スキルは以下の優先順位で **明示的に clear を判定**:

1. `reviews[-1].state == "APPROVED"` (`request_changes_workflow: true` 時、最強)
2. `unresolved CodeRabbit review threads == 0`
3. `rate-limited marker` が最新状態にない（15 分以内のものがない）
4. Summary/walkthrough コメントが最新 commit 以降に更新されている

**依存しない signal**:
- `gh pr checks` の CodeRabbit check 名（不安定、ドキュメント化されていない）
- `"approved by coderabbit.ai"` のような非公式 HTML marker
- "LGTM" / "No further actionable" のテンプレート文言（現行 public docs で確認できない）

---

## エラーハンドリング

### Codex CLI が使えない
`codex --version` が失敗したら、Codex pseudo review を skip して従来の `/coderabbit-review` にフォールバック。その旨をユーザーに通知。

### `.coderabbit.yaml` がない
`profile=chill` / `path_instructions=[]` でフォールバック実行。ただし project 品質規則は低下する旨を警告。

### Codex 疑似レビューが発散（iteration cap 到達）
`maxPseudoLoopIterations` に達したら停止し、残 findings をユーザーに提示。ユーザー判断で: (a) 更に手動修正 (b) 本物 CodeRabbit に escalate (c) Phase N 送り。

### CodeRabbit が長時間応答しない
Rate limit marker が無いにも関わらず 10 分以上新 review なし → 再 nudge (`@coderabbitai review`)。更に 10 分応答なし → ユーザーに判断仰ぐ（merge 進行 or 待機継続）。

---

## 参照

- `coderabbit-mimic` agent (`agents/coderabbit-mimic.md`)
- `/coderabbit-review` (`commands/coderabbit-review.md`) — 従来版、reviews[] polling は本スキルからも呼ぶ
- `/codex-team` (`commands/codex-team.md`) — Codex CLI 呼出の基本
- CodeRabbit docs: https://docs.coderabbit.ai/
- GitHub PR reviews API: https://docs.github.com/en/rest/pulls/reviews

---

## プロジェクト固有の適用方法

本スキルは project-agnostic。プロジェクトは以下をカスタマイズして適用:

1. `.coderabbit.yaml` を repo に置く（`path_instructions` / `reviews.profile` / `tools.*.enabled`）
2. `harness.config.json` で閾値調整（optional）
3. `.claude/rules/coderabbit-loop.md` 等でプロジェクト固有の却下技術一覧を明文化（ex: 本プロジェクトでは `react-tabulator` 採用提案を却下）
4. `CLAUDE.md` / `AGENTS.md` に project rules を書く（Codex pseudo reviewer がこれを読んで判断に使う）
