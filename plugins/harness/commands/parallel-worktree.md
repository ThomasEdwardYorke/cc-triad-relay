---
name: parallel-worktree
description: "複数サブタスクを git worktree 並列で開発するオーケストレータスキル (Model A: 単一 Claude + Agent-tool subagent)。coordinator が worktree 生成 / worker dispatch / 担当表同期 / マージ順序 / コンフリクト解消を orchestrate する。各 worker は TDD + Codex Phase 4-5 を実行し、Phase 5.5-7 は coordinator が取りまとめて実行する。単一リポジトリ (worktree なし) でもサブタスク数 1 の縮退モードとして利用可。Use when implementing 2+ independent sub-tasks in parallel with maximum quality."
description-ja: "Model A: 単一 Claude + Agent-tool で git worktree 並列の TDD 開発を orchestrate する。複数サブタスクを高品質に並列実装。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput"]
argument-hint: "[spec|feature-branch|max-parallel|max-codex-parallel|profile|dry-run|no-commit]"
---

# `/parallel-worktree` — worktree 並列 TDD 開発オーケストレータ (Model A)

## 並列実行モデルの説明

**本スキルは Model A (単一 Claude + Agent-tool subagent) で動作する。**

- **coordinator** (本スキルを実行中の Claude セッション) が全体を管理
- **worker** (`harness:worker` agent) は coordinator から Agent tool で dispatch される subagent (公式 tools-reference: `Agent` tool、旧称 `Task` は現行 catalog 未掲載)
- 各 worker は独立した worktree ディレクトリで作業するが、coordinator の context 内で動作する
- worker は `tools: [Read, Write, Edit, Bash, Grep, Glob]` / `disallowedTools: [Agent]` のため:
  - Skill tool なし → `/pseudo-coderabbit-loop` 呼出不可
  - Agent tool 禁止 → 子 agent 起動不可
- **Phase 5.5 (疑似 CodeRabbit) / Phase 6 (本物 CodeRabbit) / Phase 7 (Codex セカンドオピニオン) は coordinator が worker 完了後に実行する**

### Model B (`/parallel-worktree-v2`)

Model B is the alternative orchestrator that runs an **independent
top-level `claude` process** per worktree (sibling worktree + `claude -n <slug>` +
tmux + companion `session-manager` aggregator). It is shipped as the
sibling skill **`/parallel-worktree-v2`** and is available now.

> **Migration notice (v1 ↔ v2)**
>
> `/parallel-worktree` (this skill, Model A) **remains the default**.
> `/parallel-worktree-v2` is **opt-in recommended** when any of the
> following applies:
> - 3+ parallel sub-tasks with long-running TDD per task,
> - need per-worktree Pseudo CR / Real CR / Codex Phase 7 execution,
> - parent claude must stay responsive while workers run.
>
> Small parallel batches (2-3 short tasks) continue to fit v1 well.
> v1 and v2 coexist; pick per batch. `/parallel-worktree` (this skill)
> remains the v1 / Model A entry point and is invoked directly. When you
> need Model B, invoke `/parallel-worktree-v2` explicitly — there is no
> transparent v1 → v2 routing.
>
> Spec: `commands/parallel-worktree-v2.md`. Architecture detail:
> `docs/parallel-worktree-v2-design.md`.

---

## 基本原則

1. **TDD + Codex は各 worker で実行**: worker は TDD (Red/Green/Refactor) + Codex CLI 直接呼出 (Bash 経由) で Phase 2-5 を実行
2. **Phase 5.5-7 は coordinator 責務**: worker 完了後に coordinator が疑似 CodeRabbit / 本物 CodeRabbit / Codex セカンドオピニオンを実行
3. **Codex チーム必須**: 各 worker が Bash 経由で `codex-companion.mjs task` を呼んで並列検証
4. **妥協禁止**: 「基盤が無い」「時間がない」等の理由で TDD / Codex を外さない
5. **coordinator は orchestrate + 品質ゲート後半**: worktree 生成 / 担当表更新 / PR 作成 / CodeRabbit 監視 / マージ順序 / コンフリクト解消
6. **汎用スキル**: 全プロジェクトで使える (プロジェクト固有は `.coderabbit.yaml` / `CLAUDE.md` で自動判定)

---

## 入力仕様

### Option A: `--spec=<json-file>` で指定

```json
{
  "feature_branch": "main",
  "base_dir": "/path/to/project",
  "worktree_parent_dir": "/path/to/project-parent",
  "worktree_prefix": "myproject-wt-",
  "sub_tasks": [
    {
      "slug": "frontend-foundation",
      "task_id": "T-1",
      "title": "frontend foundation scaffold",
      "description": "...",
      "acceptance_criteria": ["..."],
      "owned_files": ["frontend/**"],
      "forbidden_files": ["pyproject.toml", "backend/*"],
      "depends_on": [],
      "merge_priority": 4
    }
  ]
}
```

### Option B: 対話的入力

引数なしで起動されたら、ユーザーに feature branch / サブタスク数 / 各タスクの詳細を尋ねる。

### Option C: Plans.md から自動抽出

`Plans.md` + 担当表運用がある場合、`wt:recommended` / `wt:coordination` ラベルタスクを自動抽出。

---

## Pre-flight

coordinator は並列開発着手前に以下を全て検証:

- [ ] `git status` clean (coordinator worktree)
- [ ] feature_branch が origin と同期
- [ ] 各 sub_task の `owned_files` / `forbidden_files` が相互に衝突しないか (**`detectOverlap()` helper で静的検査**、下記参照)
- [ ] `depends_on` チェーンに循環がないか
- [ ] `merge_priority` でマージ順序を決定
- [ ] 各 worktree dir が既存ディレクトリと衝突しないか
- [ ] Codex CLI が利用可能か (`codex --version`)
- [ ] `.coderabbit.yaml` から profile 取得 (未設定なら `chill`)

**全項目が通ってから Phase 1 へ。**

### Owned files overlap 静的検査 (`detectOverlap()`)

過去に 2 つの worktree が同 file を同時編集 → merge 順次で conflict 必至になった事象が
発生した。Pre-flight で `owned_files` 宣言を **静的に** 比較し、severity に応じて
並列度の判断材料を提示する helper を導入:

- 実装: `core/src/work/worktree-overlap.ts` (pure function、glob expansion なしの static analyzer)
- test: `core/src/__tests__/worktree-overlap.test.ts` (36 ケース、Red→Green TDD)
- API: `detectOverlap(subTasks)` → `OverlapReport`

#### Pattern language (restricted)

`detectOverlap()` は full glob を扱わず、以下の **restricted pattern language** のみ受理する。Unsupported pattern は `validatePattern()` で input 時に **throw** で reject される (false negative / false positive 防止)。

| 形式 | 例 | 扱い |
|---|---|---|
| Literal POSIX path | `src/api/foo.ts`、`backend/models.py` | ✅ accept |
| Trailing 領域 pattern | `backend/**`、`frontend/**/`、`**` | ✅ accept (territory: 末尾の double-star のみ valid) |
| 単独星 wildcard | `src/*.ts`、`*.test.ts`、`backend/api/*` | ❌ reject |
| Suffix-bearing 領域 | `src/**/test.ts`、`**/foo.ts`、`dir/**/file.ts` | ❌ reject (false positive 防止) |
| Character class | `[abc].ts` | ❌ reject |
| `?` placeholder | `src/foo?.ts` | ❌ reject |
| Windows backslash | `src\\foo.ts` | ❌ reject |
| Leading `./` | `./src/foo.ts` | ❌ reject |
| 連続 `//` | `src//foo.ts` | ❌ reject |
| Trailing whitespace | `src/foo.ts ` | ❌ reject |

**設計判断**: full glob semantics は glob library + runtime fs 比較が必要だが、Pre-flight phase は worktree 未populated のため fs 比較不可。Author は (a) literal path で fine-grained 宣言、(b) trailing `dir/**` で broad territory 宣言の **2 択** に絞る。中間の `*.test.ts` 系は本 analyzer の対象外として明示的に reject。



#### Severity 分類

| severity | 条件 | 推奨アクション |
|---|---|---|
| **high** | 同 literal pattern が両側に declare、かつ A 側または B 側 ownedFiles の coverage が **strictly 50% 超** (50% 丁度は medium 扱い)。両側 coverage は独立に算出 (asymmetric ケースを正しく評価) | `consolidate-into-single-pr` (1 PR に統合する判断材料) |
| **medium** | owned overlap あり、かつ `high` 条件不成立の全ケース。具体的には (a) exact-literal だが coverage ≤ 50% (例: 1 pattern in 2-element array)、(b) 親子 glob のみ (`backend/**` ⊃ `backend/api/*`)、(c) その他 owned overlap 全般 (high の余事象) | `serialize` (`merge_priority` で順次化) |
| **low** | owned overlap なし、forbidden cross-violation のみ | `parallel-ok` (警告のみ、並列実行可) |

#### Recommendation

`OverlapReport.summary.recommendation` は以下のいずれか:

- `parallel-ok` — 全 pair が low or 重複なし → 当初の sub_task 配分で並列 OK
- `serialize` — 1+ pair が medium、high なし → `merge_priority` 設定 + 順次 merge で衝突回避
- `consolidate-into-single-pr` — 1+ pair が high → そのペアは同 PR に統合 (or 直列化) して conflict を構造的に排除

#### 使用例

```typescript
import { detectOverlap } from "@cc-triad-relay/core/work/worktree-overlap";

const report = detectOverlap([
  { slug: "fe-foundation", ownedFiles: ["frontend/**"] },
  { slug: "be-foundation", ownedFiles: ["backend/**"] },
  { slug: "shared-types",  ownedFiles: ["shared/types.ts"] },
]);
// report.summary.recommendation === "parallel-ok"
```

```typescript
const report2 = detectOverlap([
  { slug: "task-a", ownedFiles: ["commands/harness-merge-train.md"] },
  { slug: "task-b", ownedFiles: ["commands/harness-merge-train.md"] },
]);
// report2.pairs[0].severity === "high"
// report2.summary.recommendation === "consolidate-into-single-pr"
//   → 当初 2 PR 計画を 1 PR に統合する判断材料として coordinator に提示
```

`detectOverlap()` は **declarative input のみを比較する** 設計。glob expansion や fs
アクセスは行わず、宣言済 territorial boundary の整合性を検査する。

### WorktreeCreate hook との共存

harness plugin は `WorktreeCreate` hook を blocking protocol で実装しており、agent
frontmatter `isolation: worktree` を持つ subagent が起動すると自動的に sibling
worktree を作成する。本スキル (`/parallel-worktree`) の手動 `git worktree add` 運用と
**二重 worktree 作成**が発生しないよう、以下の invariant を守る:

- **現行**: 同梱 agent はいずれも `isolation: worktree` を付与していない。本スキルから
  dispatch される subagent は main repo の context で動き、coordinator が事前に作成した
  `worktree_parent_dir/worktree_prefix<slug>` に `cd` で入るだけ。
- **将来特定 agent で `isolation: worktree` を有効化する場合**: 本スキルの Phase 1
  worktree 生成と協調するロジックが必要。二重作成を避けるには以下いずれかを選択:
  - (a) 該当 agent を使う時は coordinator 側 `git worktree add` を skip する
    (isolation hook に任せる)
  - (b) coordinator 手動 worktree の path / branch 命名を hook 側と整合させ、hook の
    idempotent 再利用経路で吸収する

  **(b) の制約 (重要)**: handler の `findExistingWorktree` は **path + branch の完全
  一致**で reuse 判定する (path は `<basename-of-cwd>-wt-<name>` sibling 規約、branch
  は `harness-wt/<name>`)。既存 `/parallel-worktree` の default (path =
  `worktree_prefix<slug>`、branch = `${feature_branch}-${slug}`) とは命名体系が異なる
  ため、**そのまま (b) は効かない**。(b) を選ぶなら (1) handler 側を拡張して両命名を
  normalize しつつ検出する、または (2) coordinator 側の `worktree_prefix` / branch 名
  を handler 期待形式 (`<basename>-wt-` / `harness-wt/`) に揃える、のどちらかが必要。

  追加実装が不要な現行推奨は **(a)** — coordinator 側で事前に作成し、isolation を
  有効にした agent では WorktreeCreate hook の実作業 (git worktree add) を skip させる
  (例: 環境変数で coordinator 管理下フラグを伝え、hook 側で早期 return)。

---

## Phase 1: Worktree 生成 + 担当表更新

```bash
git worktree add "${worktree_parent_dir}/${worktree_prefix}${slug}" \
  -b "${feature_branch}-${slug}" "${feature_branch}"
```

Plans.md 担当表に `status=in_progress` で行追加 (coordinator 専任)。

---

## Phase 2: 各 worktree に worker agent を dispatch (並列)

各 sub_task に対して `harness:worker` agent を `run_in_background=true` で並列起動。

### worker に渡すプロンプトの必須要素

```markdown
# Task: <task_id> <title>

## Working directory
cd <worktree_dir>
branch: <feature_branch-slug>
**main repo には触らない。**

## Environment Manifest (prepended to worker prompt, mandatory)

The coordinator MUST prepend an Environment Manifest to the worker prompt to
mitigate failures caused by environment / version mismatches between local and
CI runtimes (e.g. database version differences where one side has unsupported
syntax / features). Without the manifest, a worker can misinterpret an
infra-driven test failure as a code defect and explore forbidden workarounds
(migration skip / manual SQL test DB setup / version-specific local-only syntax
rewrite). Localized rationale and observed failure-mode notes are documented
in the project handoff docs (consumer-side `docs/` notes); this spec keeps the
canonical contract locale-neutral.

**注入する内容 (project ごとに異なるが、典型例)**:

```text
## Environment Manifest (known infra constraints)

- Local <runtime> is <version-A> (CI is <version-B>).
- A migration uses DB features unavailable in some local/CI environments.
- Local migration may fail for this known reason.
- This is a known infrastructure limitation, not a task failure to fix.

### Forbidden actions (do not bypass migrations)

- migration skip / migration bypass で test DB を作る
- 手動 SQL (manual SQL) で migration の一部を再現
- DB-specific syntax を local-only に書換
- fake schema を test fixture で構築して migration failure を隠す

### Allowed fallback when blocked by infra

- DB 不要範囲の unit / collection / static check は実施
- known infra limitation として `INFRA_BLOCKED` 報告 + 撤退
- coordinator に CI と同等環境での検証を依頼
```

**取得元**: project の `harness.config.json` から `environmentManifest`
field を読み取って prompt に inject する。

**実装契約は free-form object**:
`plugins/harness/schemas/harness.config.schema.json` と
`plugins/harness/core/src/config.ts` の両方で `environmentManifest` は
`additionalProperties: true` の自由形式 object と定義されている (sub-key の
構造を strict には強制しない)。`validateEnvironmentManifest()` は
**plain object か undefined か** だけを runtime で gate する。下記の
example schema は project が任意で採用できる **推奨キー例 (suggested
structure / example keys)** であり、必須契約ではない:

```json
{
  "environmentManifest": {
    "<runtime>": {
      "version": "<version>",
      "unsupported_features": ["<feature>"]
    },
    "<other-runtime>": { "version": "<version>" },
    "ci_environment": {
      "<runtime>_version": "<version>"
    },
    "forbidden_workarounds": [
      "<workaround 1>",
      "<workaround 2>"
    ]
  }
}
```

field 推奨ガイドライン (MUST ではなく recommendation):
- 各 sub-key (`<runtime>` / `<other-runtime>` / etc) は推奨として object
  (`version` / `unsupported_features`) で記述するが、実装契約は free-form
  object なので未知キー / 別構造も許容
- `ci_environment` は推奨キーで、CI 側の version / 制約を別途宣言する用途
  (local と CI の差分が明示できる構造)
- `forbidden_workarounds` は推奨キーで、project 固有の禁止迂回 list を保持
  (worker.md generic 禁止 list の補強)
- field 全体が欠落している project では Environment Manifest section を **空
  ヘッダのみ** で出して「明示すべき infra 制約なし、infra 失敗時は
  INFRA_BLOCKED で撤退してよい」契約を伝える

**Materialization (JSON → markdown transformation algorithm)**:

coordinator は `harness.config.json.environmentManifest` JSON を以下の **推奨
規則** で markdown bullet list に変換し、worker prompt 先頭に inject する
(下記は推奨キー (`version` / `unsupported_features` / `ci_environment` /
`forbidden_workarounds`) を使った場合の transformation。free-form 構造の
場合は coordinator が任意の形式で markdown 化してよい):

| JSON 構造 (推奨キー) | markdown 出力 |
|---|---|
| `<key>: { "version": <V>, "unsupported_features": [<list>] }` | `- <Key 大文字化> <V> — unsupported: <comma-separated>` |
| `<key>: { "version": <V> }` (unsupported なし) | `- <Key 大文字化> <V>` |
| `ci_environment: { "<tool>_version": <V>, ... }` | `- (CI: <tool> <V>, ...)` (1 行サマリ) |
| `forbidden_workarounds: [<list>]` | `### Forbidden actions (project-specific)\n- <each item>` |
| 推奨キー以外の自由構造 | coordinator が任意で markdown 化 (free-form fallback) |
| field 全体未定義 | 空 `## Environment Manifest` ヘッダのみ |

**Newline sanitization (mandatory for all string values)**: free-form values
in `environmentManifest` (and any other coordinator-injected payload such as
`additionalContext`) are JSON-decoded strings that may contain literal
newlines. Before emitting them as markdown bullets, the coordinator MUST
normalize and escape every newline sequence (`\r\n` / `\n` / `\r`) to the
**literal two-character sequence `\\n`** so a malicious / accidental newline
cannot inject pseudo-section boundaries (e.g. forging a fake `## Task:`
header inside a free-form value). This rule is identical to the
`additionalContext` payload sanitization elsewhere in the harness — the same
escape policy applies consistently across both surfaces.

具体例 (推奨キー使用、JSON input):

```json
{
  "environmentManifest": {
    "<runtime>": { "version": "<v-local>", "unsupported_features": ["<feature>"] },
    "<other-runtime>": { "version": "<v-local>" },
    "ci_environment": { "<runtime>_version": "<v-ci>", "<other-runtime>_version": "<v-ci>" },
    "forbidden_workarounds": [
      "migration skip / migration bypass",
      "manual SQL test DB setup",
      "version-specific syntax 書換 (local-only variant)"
    ]
  }
}
```

coordinator は worker prompt 構築時に以下の順序で組み立てる:

1. (frontmatter があれば最初に置く)
2. **Environment Manifest block を prepend** (frontmatter 後、task 説明の前)
3. task 詳細 (タスク説明 / Working directory / Acceptance Criteria 等)

実装例 (上記 JSON input を materialization した markdown output、placeholder
に project 固有の値が入る):

```markdown
## Environment Manifest (known infra constraints)

- <Runtime> <v-local> — unsupported: <feature>
- <Other-runtime> <v-local>
- (CI: <runtime> <v-ci>, <other-runtime> <v-ci>)

### Forbidden actions (project-specific)
- migration skip / migration bypass
- manual SQL test DB setup
- version-specific syntax 書換 (local-only variant)

(generic 禁止迂回は agents/worker.md "Forbidden Infrastructure Workarounds" 参照)

## Task: <task_id> <title>

...
```

malformed 検出時 (例: `environmentManifest` が string、不正な JSON):
coordinator は **fatal error で停止** (worker dispatch 前に halt) し、
project 側の `harness.config.json` を修正してから再実行する。silent fallback
で garbage を prompt に inject すると worker の判断材料が破壊されるため。

worker は `agents/worker.md` の **Forbidden Infrastructure Workarounds**
section と本 Environment Manifest を照合し、infra-driven failure を判定する。

## オプションの伝播 (--no-commit forward 規約: --no-commit forward)

coordinator は `$ARGUMENTS` から以下を抽出し、各 worktree への `/tdd-implement` 呼出に materialize してから渡す:

- `--profile=chill|assertive|strict`: Phase 5.5 / 6 の疑似 / 本物 CodeRabbit に伝播
- `--no-commit`: Phase 8 commit step を抑制 (tdd-implement 側で skip)
- `--max-codex-parallel=N` (default 1, integer >= 1): worker が Phase 4 で発射する `node codex-companion.mjs task` の同時実行上限。worker prompt 冒頭に `export MAX_CODEX_PARALLEL=$N` として inject し、Phase 4 の Codex 呼出を `scripts/codex-semaphore.sh` で wrap させる (subagent context overflow / parallel timeout 防止)

```bash
# $ARGUMENTS を配列化 (zsh でも 0-based に揃える)
[ -n "${ZSH_VERSION:-}" ] && emulate -L bash
read -r -a ARGS_TOKENS <<< "$ARGUMENTS"

PROFILE="chill"
NO_COMMIT=""
MAX_CODEX_PARALLEL="1"
for tok in "${ARGS_TOKENS[@]}"; do
  case "$tok" in
    --profile=chill|--profile=assertive|--profile=strict)
      PROFILE="${tok#--profile=}"
      ;;
    --no-commit)
      NO_COMMIT="--no-commit"
      ;;
    --max-codex-parallel=*)
      v="${tok#--max-codex-parallel=}"
      # 整数 >= 1 を強制 (semaphore は max=0 を許容しないため runtime fail を避ける)
      if [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 1 ]; then
        MAX_CODEX_PARALLEL="$v"
      else
        echo "ERROR: --max-codex-parallel must be integer >= 1 (got '$v')" >&2
        exit 1
      fi
      ;;
  esac
done

# 各 worktree へ forward:
#   /tdd-implement ${SUBTASK} --profile=${PROFILE} ${NO_COMMIT}
# materialize 後 (例):
#   /tdd-implement T-12 --profile=assertive --no-commit
#   /tdd-implement T-13 --profile=assertive
#
# また worker prompt 冒頭に env export を 1 行付与する (Codex 並列度制御):
#   export MAX_CODEX_PARALLEL=$MAX_CODEX_PARALLEL
# worker (harness:worker agent) は Phase 4 Codex 呼出時にこの env を読み、
# scripts/codex-semaphore.sh acquire/release で同時実行を制限する。
```

## 実行フロー (Model A: worker 責務範囲)

### Phase 2: RED
- 失敗するテストを先に書く
- テスト削除・弱体化禁止

### Phase 3: GREEN
- 最小実装でテスト通過
- 全既存テスト維持

### Phase 4: Codex 並列検証 (必須)
Bash で Codex CLI を直接呼んでレビュー依頼。3+ worker が同時に Codex を叩くと
parent subagent context が overflow し、各 worker が Codex 完了時に結果を return
できず全件 timeout する (再現率 100%)。これを防ぐため `scripts/codex-semaphore.sh`
で Codex 並列度を coordinator 指定の `MAX_CODEX_PARALLEL` (default 1) に制限する:

```bash
CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
# Fail-fast: codex plugin 未 install / cache 未展開で node を無引数呼びすると分かりにくい
# error で落ちるため、ここで検出して明示的に停止する。
if [ -z "$CODEX_COMPANION" ] || [ ! -f "$CODEX_COMPANION" ]; then
  echo "ERROR: codex-companion.mjs not found. Run /codex:setup or reinstall codex plugin." >&2
  exit 1
fi

# Codex parallelism control: resolve the semaphore script path. The coordinator
# forwards MAX_CODEX_PARALLEL (default 1) via env. The harness plugin's
# marketplace name is allowed to differ between installs, so make it overridable
# via HARNESS_MARKETPLACE_NAME (default: cc-triad-relay, the upstream-shipped
# name); fall back to both the active install location and the cached one for
# resilience across plugin reinstalls.
HARNESS_MARKETPLACE_NAME="${HARNESS_MARKETPLACE_NAME:-cc-triad-relay}"
SEM_BIN=""
for CAND in \
  "$HOME/.claude/plugins/marketplaces/${HARNESS_MARKETPLACE_NAME}/plugins/harness/scripts/codex-semaphore.sh" \
  "$HOME/.claude/plugins/cache/${HARNESS_MARKETPLACE_NAME}/harness/scripts/codex-semaphore.sh"; do
  if [ -x "$CAND" ]; then SEM_BIN="$CAND"; break; fi
done
MAX_PAR="${MAX_CODEX_PARALLEL:-1}"

if [ -n "$SEM_BIN" ] && [ "$MAX_PAR" -ge 1 ]; then
  SLOT=$("$SEM_BIN" acquire "$MAX_PAR")
  trap "'$SEM_BIN' release '$SLOT'" EXIT INT TERM
  node "$CODEX_COMPANION" task "実装レビュー: <task概要>" --effort medium
  "$SEM_BIN" release "$SLOT"
  trap - EXIT INT TERM
else
  # Semaphore unavailable. Behaviour depends on requested parallelism:
  #   MAX_PAR > 1 → fatal exit. Silently falling back to unconstrained
  #     parallel Codex re-introduces the subagent context overflow that this
  #     guard was added to prevent (observed: 3+ long-running parallel reviews
  #     hit a 100% timeout / lost-result rate). Refusing here forces the
  #     operator to fix the install (semaphore script missing) before paying
  #     for another lost-result run.
  #   MAX_PAR == 1 (sequential, the safe default) → WARN + continue. A single
  #     Codex review cannot overflow context, so the legacy unconstrained path
  #     is acceptable as a graceful degradation when semaphore is missing.
  if [ "$MAX_PAR" -gt 1 ]; then
    echo "ERROR: scripts/codex-semaphore.sh not found but --max-codex-parallel=$MAX_PAR > 1." >&2
    echo "       refusing to fall back to unconstrained parallel Codex (subagent context overflow risk)." >&2
    echo "       fix: ensure the harness plugin marketplace (HARNESS_MARKETPLACE_NAME, default cc-triad-relay) is installed and codex-semaphore.sh is executable." >&2
    exit 1
  fi
  # MAX_PAR=1: caller intent is "no parallel Codex anyway", so the missing
  # semaphore degrades cleanly. WARN explicitly so an operator who *did*
  # set MAX_CODEX_PARALLEL=1 in env (vs default-1) can still see that the
  # semaphore install is missing and would silently fail if they raise N.
  echo "WARN: scripts/codex-semaphore.sh not found. MAX_CODEX_PARALLEL=$MAX_PAR is honored as sequential, but raising it without installing the semaphore script will fall back to fatal exit. Install: ensure the harness plugin marketplace (HARNESS_MARKETPLACE_NAME, default cc-triad-relay) is present and codex-semaphore.sh is executable." >&2
  node "$CODEX_COMPANION" task "実装レビュー: <task概要>" --effort medium
fi
```

### Phase 5: Codex レビューループ (必須)
critical/major が 0 になるまで反復。

### Phase 5.5-7: coordinator 実施 (worker は担当外)
Phase 5.5 (疑似 CodeRabbit) / Phase 6 (本物 CodeRabbit) / Phase 7 (Codex セカンドオピニオン) は **coordinator が worker 完了後に実行する**。worker は push まで実施して完了報告。

## ファイル所有権
- 触ってよい: <owned_files>
- 絶対に触らない: <forbidden_files>
- Plans.md は coordinator 専任

## Push
```bash
git push -u origin <feature_branch-slug>
```
PR 作成はしない (coordinator 実施)。

## 完了報告
1. 最終 commit hash
2. diff stat
3. 全テスト結果
4. 静的解析結果
5. Codex 並列検証サマリ (Phase 4)
6. Codex レビューループで直した項目 (Phase 5)
7. Follow-up notes (coordinator が拾うべき残課題)
```

### 並列数の調整

- `--max-parallel=N` 未指定なら `min(サブタスク数, 4)` — worker (Agent tool subagent) の同時実行数
- `--max-codex-parallel=N` (default 1) — 各 worker が Phase 4 で発射する Codex CLI の同時実行数。`scripts/codex-semaphore.sh` 経由で lock-dir-based semaphore (mkdir 原子性) を使い制御。`--max-parallel=4 --max-codex-parallel=2` のように **「worker 数 ≥ Codex 並列度」を逆転させない**こと (worker が semaphore で全員 sleep する状況を避ける)
- Agent は `run_in_background=true`

---

## Phase 3: monitor + acceptance + mechanical verification (coordinator)

After each agent completes, the coordinator MUST mechanically verify the
result. Plain-text final reports cannot be trusted as completion evidence
(observed failure: workers leave intent statements at the end without
performing commit / push, and the natural-language wording can read as
"done" while no artifact exists). The coordinator therefore validates the
final via artifacts (git state + structured 8-field schema) instead of
prose.

### 機械的最終確認 (mechanical verification、自然文を信用しない)

worker final を受領したら、以下を **すべて機械的に確認** (coordinator-side
verification、artifact-driven completion judgment):

1. **git status の確認** — `cd <worktree_dir> && git status --short` で
   uncommitted changes が残っていないかをチェック (DONE 報告と不整合なら
   reject)
2. **git log -1 の確認** — `cd <worktree_dir> && git log -1 --format=%H%n%s`
   で expected branch に commit があるか + commit message が要件と一致
3. **push 到達確認 (commit hash 一致まで verify)** — remote branch の
   存在確認だけでは古い head が remote に残っているだけで pass してしまう
   (worker がローカル最新 commit を push していなくても remote branch は
   過去 push の頭が居るため検出すり抜け)。**local HEAD と remote ref の
   commit hash 一致**まで確認:

   ```bash
   # local commit (worker が報告した COMMIT field、もしくは worktree HEAD)
   LOCAL_COMMIT=$(git -C <worktree_dir> rev-parse HEAD)
   # remote ref の hash — `--heads` + `refs/heads/<branch>` で branch ref に
   # 限定 (同名 tag / その他 ref が存在するとき複数行 match で wrong hash を
   # 拾う事故を予防、必ず単一 head ref を取得)
   REMOTE_COMMIT=$(git ls-remote --heads origin "refs/heads/<feature_branch-slug>" | awk '{print $1}')
   if [ -z "$REMOTE_COMMIT" ] || [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
     echo "INTERRUPTED: pushed branch hash mismatch (local=$LOCAL_COMMIT remote=$REMOTE_COMMIT)"
     # STATUS: DONE を reject、worker に再 push 依頼 (PARTIAL 扱い)
   fi
   ```

   `LOCAL_COMMIT` と `REMOTE_COMMIT` が一致しない場合、`STATUS: DONE` を
   reject して PARTIAL 降格 + 再 push 依頼 (`SendMessage`)。
4. **8-field schema 検証** — worker final が **plain-text colon-separated
   values** 形式で以下 8 field を **全て** 含むか確認 (`agents/worker.md`
   の **完了報告フォーマット (8-field schema)** と完全一致):

   ```text
   STATUS: <DONE | PARTIAL | BLOCKED | FAILED>
   CHANGED_FILES: <count or list>      # 空なら "(none)"
   COMMIT: <hash>                       # 調査タスクなら "(none)"
   PUSHED_BRANCH: <branch>              # push なしなら "(none)"
   VALIDATION: tests=PASS lint=PASS typecheck=PASS  # 1 行サマリ可、SKIPPED+理由 OK
   BLOCKERS: <reason>                   # BLOCKED 以外は "(none)"
   NEXT_ACTION: <command>               # DONE は "(complete)"、PARTIAL/BLOCKED は次 1 command
   FORBIDDEN_ACTIONS_USED: <yes | no>   # yes は規律違反 (ledger 追記)
   ```

   field 欠落 / 形式不正 → 委譲先に追加対応依頼 (再 dispatch、Step 5 経路)。
   8 field の意味と必須条件は `agents/worker.md` の "8 field の意味" / "タスク
   区分" table を canonical reference とする。
5. **未来形 detector (future-tense detection)** — まず上記 8-field schema
   `STATUS:` marker の存在を **primary signal** として確認。schema が揃って
   いる場合は marker を信用し regex scan は skip する (false-positive 回避)。
   schema 不在または `STATUS: DONE` でも疑わしい場合のみ補助的に regex scan:

   ```bash
   # primary: STATUS marker の存在検査 (主) — 揃っていれば marker を信用。
   # NOTE: `grep -E` (POSIX ERE) は `\s` を literal `s` に解釈するため、
   # whitespace match には `[[:space:]]` を使う (bash builtin の `[[ =~ ]]` も同様)。
   # 行末 anchor `$` も併用して `STATUS: DONE_xxx` のような不正値を弾く
   # (commands/harness-work.md Step 5 と同じ exact-match 規約)。
   if ! grep -qE '^STATUS:[[:space:]]*(DONE|PARTIAL|BLOCKED|FAILED)$' worker-final.txt; then
     echo "INTERRUPTED: STATUS marker missing"
     exit 1
   fi
   # secondary: STATUS: DONE のときだけ末尾 5 行を狭い regex で scan
   #   - 引用 (`>` 行) と code fence (``` 内) を strip して inline 文のみを対象
   #     (harness-work.md Step 5 と同じ前処理、quote / fence 内の intent 文の
   #     false-positive を抑制)
   #   - sentence-end (。/./!) anchor で intent 文の文末位置に限定
   #   - subject が agent (I / We / Next I / 自分) のもののみ拾う
   if grep -qE '^STATUS:[[:space:]]*DONE$' worker-final.txt; then
     tail -n 5 worker-final.txt \
       | sed -E '/^>/d' \
       | awk 'BEGIN{f=0} /^```/{f=1-f; next} !f' \
       | grep -E '(^|[。\.!])[[:space:]]*(修正|実行|確認|更新)します[。\.!]?[[:space:]]*$|^(I|We|Next I) (will|am going to) (fix|run|update|confirm)' \
       && echo "INTERRUPTED: future-tense at sentence end with agent subject, downgrading to PARTIAL"
   fi
   ```

   primary signal (STATUS marker) で完了判定するのが本筋。regex は schema 不在
   時の fallback または明らかな false-positive (intent 文末) 検出のみ。
6. **BLOCKED / PARTIAL handoff parser** — `STATUS: BLOCKED` または
   `STATUS: PARTIAL` の場合、`BLOCKERS` / `NEXT_ACTION` field を parse して
   coordinator が次の action を判断:
   - **BLOCKED + INFRA_BLOCKED**: 同じ worker / 同じ環境に再 dispatch
     **しない** (infra 制約は worker 側では変わらないため retry 無意味)。
     代わりに以下のいずれかを coordinator が選択:
     - (a) **別環境で再実行**: CI 環境 / human-driven 環境 / 別 PR で
       infra 制約を満たす版を実行
     - (b) **コードを修正して回避**: coordinator または別 worker が、
       infra 制約に依存しない実装に書き換え (例: DB-dependent test を
       SKIPPED 経路に分割)
     - (c) **escalate to user**: 上記 (a) (b) のどちらも実行不能なら
       ユーザーに判断委譲
   - **PARTIAL**: 残作業を別 worker / coordinator が継続、`NEXT_ACTION` の
     1 command を採用
   - **FAILED**: 要件再確認 + ユーザーに escalation
7. **`FORBIDDEN_ACTIONS_USED: yes` 検出** — yes の場合は規律違反として
   discipline ledger に append-only 追記、PR は merge せず該当 commit を
   revert 検討

### 完了報告 verification の旧 contract (互換)

過去の Phase 4/5 記述要件 (Codex 並列検証 / Codex レビュー summary) は
8-field schema の `VALIDATION` + Markdown 拡張形式で吸収される:

1. push が origin に到達しているか (`git ls-remote`)
2. 完了報告の Phase 4/5 に記述があるか (省略なし)
3. 省略があれば `SendMessage` で追加対応依頼

省略 / 未来形検出 / 8-field schema 不整合があれば `SendMessage` で worker に
追加対応依頼するか、coordinator 側で finalize する。

---

## Phase 4: Coordinator の品質ゲート後半 (Phase 5.5-7)

各 worktree の push 完了後、coordinator が:

1. **Phase 5.5 疑似 CodeRabbit** (`/pseudo-coderabbit-loop --local --profile=$PROFILE`)
   - coordinator は `$ARGUMENTS` から `--profile=` を抽出して `$PROFILE` を束縛 (argv 単位 case 完全一致):

     ```bash
     # Shell 互換: bash 必須 (read -r -a / 配列 0-based / unset 'arr[idx]' は bash 拡張)。
     # BASH_VERSION 未設定なら fail-fast (zsh / sh では silent degrade するため)。
     if [ -z "${BASH_VERSION:-}" ]; then
       echo "ERROR: /parallel-worktree argv parser requires bash." >&2
       exit 1
     fi
     [ -n "${ZSH_VERSION:-}" ] && emulate -L bash
     read -r -a ARGS_TOKENS <<< "$ARGUMENTS"
     PROFILE="chill"
     for tok in "${ARGS_TOKENS[@]}"; do
       case "$tok" in
         --profile=chill|--profile=assertive|--profile=strict)
           PROFILE="${tok#--profile=}"
           ;;
       esac
     done
     ```
   - 解決後の `$PROFILE` を materialize して `/pseudo-coderabbit-loop` に渡す (literal `<profile>` 禁止)
   - 実例: `--profile=strict` / `--profile=assertive` / `--profile=chill`
   - actionable=0 まで反復
   - rate limit 無関係 (Codex ベース)
2. **PR 作成** (`gh pr create --base <feature_branch> --head <feature_branch-slug>`)
3. **Phase 6 本物 CodeRabbit** (`/coderabbit-review <pr>`)
   - Clear 3 段判定 (APPROVED / unresolved=0 / rate-limited marker 不在)
   - rate limit ヒット時は `/pseudo-coderabbit-loop <pr> --profile=$PROFILE` に切替 (Phase 4 で解決した `$PROFILE` を PR-mode fallback にも materialize 伝播)
     - 実例: `/pseudo-coderabbit-loop 42 --profile=strict`
4. **指摘対応**: 当該 worktree の agent に `SendMessage` で返す → 再修正 → 再 push
5. **Phase 7 Codex セカンドオピニオン** (`/codex-team adversarial` or `harness:codex-sync`)

   parallel worktree で `harness:codex-sync` を直接 spawn する場合、`name` 引数を
   per-worktree でユニーク化することで `SendMessage` resume + truncate recovery
   を確保する (codex-sync.md "Handling Mid-Response Truncation" 参照):

   ```text
   Agent({
     subagent_type: "harness:codex-sync",
     name: "codex-sync-track-a-phase7",
     description: "Track A Phase 7 adversarial review",
     prompt: "PR #<pr-a> の全差分を adversarial review..."
   })
   ```

   `<track>` は worktree slug (例: `track-a` / `track-b`) を反映。同 worktree 内
   で複数回呼ぶ場合は `<phase>` も付与 (例: `codex-sync-track-a-phase4-cleanup`)。

---

## Phase 5: マージ順序 + コンフリクト解消

- `merge_priority` 昇順で PR を merge
- 各 merge 後、残 worktree を rebase
- コンフリクト:
  - 軽微 → coordinator が直接解消
  - 複雑 → 当該 worktree agent に resume 指示
  - 解消後 `git push --force-with-lease` (ユーザー承認必要)

---

## Phase 6: Worktree cleanup + 担当表クリア

```bash
for slug in "${slugs[@]}"; do
  git worktree remove "${worktree_parent_dir}/${worktree_prefix}${slug}"
  git branch -d "${feature_branch}-${slug}"
done
git worktree prune
```

Plans.md 担当表から行削除、完了セクションに追記。

---

## Phase 7: ドキュメント更新 + セッション引継

- Plans.md 完了セクションに Round 総括
- プロジェクト固有のセッション引継ファイル (`harness.config.json` の `work.handoffFiles` 等で指定、存在すれば) を更新
- Memory 更新 (恒久情報のみ)

---

## 単一リポジトリ縮退モード

サブタスク数 = 1 or `--max-parallel=1`:
- Phase 1 の worktree 生成を skip
- coordinator が直接 `/tdd-implement` v2 を起動。**profile は解決済み実値を materialize して handoff**:

  ```text
  # テンプレート (Phase 4 で束縛した $PROFILE を使用)
  /tdd-implement <task description> --profile=$PROFILE

  # 実例 (PROFILE=strict の場合)
  /tdd-implement "Add feature X" --profile=strict
  ```
- Phase 4 以降は同じ (rate-limit fallback でも `--profile=$PROFILE` を維持)

---

## 禁止事項

- worker が Phase 5.5-7 を自力実行すると主張すること (Model A では不可能)
- Phase 4/5 (Codex チーム) を省略すること
- Plans.md を leaf worktree が編集すること
- 他 worktree の所有ファイルを編集すること
- 「時間がない」等の理由で品質を落とすこと

---

## 関連スキル

| スキル | 呼び出し元 / 使い方 |
|---|---|
| `/tdd-implement` v2 | 縮退モードで直接起動 |
| `/pseudo-coderabbit-loop` | Phase 4 で coordinator が実行 (Phase 5.5) |
| `/coderabbit-review` | Phase 4 で coordinator が実行 (Phase 6) |
| `/codex-team` | Phase 4 で coordinator が実行 (Phase 7) |
| `harness:worker` | 各 worktree の worker agent |
| `harness:codex-sync` | Codex 並列呼出 |

---

## Model B 運用ガイド (B-manual)

**前提**: Phase 2 (2026-04-21) で実装された `scripts/parallel-sessions.sh` を使用。

### B-manual の起動フロー

```bash
# 1. 複数 worktree を一括起動 (各 worktree で独立 claude プロセス)
scripts/parallel-sessions.sh start-batch crud-projects crud-locations crud-materials

# 2. 各 tmux session にアタッチして指示
scripts/parallel-sessions.sh attach crud-projects
# → claude が起動済み。/tdd-implement で実装指示を投入

# 3. coordinator 側で進捗監視
scripts/monitor-worktrees.sh --watch

# 4. 完了後にクリーンアップ
scripts/parallel-sessions.sh stop crud-projects
```

### B-manual の利点 (Model A との差分)

| 項目 | Model A | B-manual |
|---|---|---|
| 各 worker の context | 親 context 共有要約 | **独立 1M context** |
| 各 worker の harness | 限定 tools | **全 harness** (symlink 経由) |
| Skill tool | 不可 | **可能** |
| Agent tool | 禁止 (OOM) | **可能** (top-level) |
| 品質ゲート | coordinator 依存 | **各 worker が自律実行** |
| MCP | 不可 | **可能** |

### B-manual で各 worker が実行するフロー

各 worktree の独立 claude は top-level プロセスなので、Model A の制限がない:

1. `/tdd-implement` を直接実行可能 (Phase 1-8 全て)
2. `/pseudo-coderabbit-loop --local` を worker 内で実行可能
3. `codex-team` による Codex セカンドオピニオンも worker 内で完結
4. PR 作成・CodeRabbit 対応も worker 自身が可能

coordinator の役割は:
- worktree 生成 / 削除の orchestration
- Plans.md 担当表の管理
- マージ順序 / コンフリクト解消
- 全体進捗の監視

### sibling worktree の .claude/ 共有

`parallel-sessions.sh start` は以下を自動 symlink する:
- `.claude/` → main repo の `.claude/` (settings, rules)
- プロジェクト固有の個人設定ファイル (存在すれば) → main repo の同名ファイル
- `.docs/` → main repo の `.docs/`

git tracked ファイルは worktree に自然に存在:
- `CLAUDE.md`, `.mcp.json`, `harness.config.json`

user level (`~/.claude/plugins/`) は全 claude プロセスで共有。

---

## スキル更新履歴

- **v2.0 (2026-04-21)**: Model B (B-manual) 運用ガイド追加。`scripts/parallel-sessions.sh` + symlink による sibling worktree 独立 claude 実行をサポート。
- **v1.1 (2026-04-21)**: Model A を正直に記述。worker の責務範囲を Phase 2-5 に限定、Phase 5.5-7 は coordinator 責務に明確化。Model B への将来移行パスを記載。
- **v1 (2026-04-19)**: 開発プロセス上の反省を踏まえて新設 (詳細は CHANGELOG.md)。


---

## Handoff-mode Awareness Note

本 spec は legacy plans-mode (`Plans.md` 駆動) を前提とした表現で書かれている。`harness.config.json.work.taskTrackerMode = "handoff"` (template default、`harness init` で適用) project では本文中の `Plans.md` 言及を以下に読み替える:

- **Active task の dispatch / 担当表 / 進捗** → `.docs/handoff/<project>-backlog.md` + `.docs/handoff/<project>-current.md`
- **完了履歴の append** → `History.md` (旧 Plans.md、`harness init` で生成または migration)
- **Phase / Week / Task SSoT** → `.docs/handoff/<project>-roadmap.md`
- **設計判断 (append-only)** → `.docs/handoff/<project>-decisions.md`

詳細は README "Plans-mode vs Handoff-mode" section + `harness.config.json` schema (HANDOFF_PATH_KEYS = `["backlog", "current", "decisions", "roadmap"]`) 参照。

(本 note は generic awareness footer、複数 commands ファイルに一括追加。各 file 本文の `Plans.md` 言及を併記 update せず、handoff-mode user は本 footer を read-and-translate する設計。Phase 1 完了後に detail update を別 PR で実施可能。)
