---
name: harness-work
description: "Plans.md 駆動の実装 + merge orchestration ディスパッチャ (v5)。タスク数で Auto Mode Detection (Solo / Parallel / Breezing) し内部的に `/tdd-implement` v2 / `/parallel-worktree` v1 に委譲、また `--merge` flag または detect_merge_orchestration() シグナル成立で `/harness-merge-train` (multi-PR squash merge) に委譲し、TDD + Codex チーム並列 + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオン + skill connectivity の完全品質ゲートを常時強制する。バグ修正・機能追加・複数 PR squash merge orchestration を統合。Use when user mentions: implement, execute, fix bug, add feature, merge multiple PRs, /harness-work, /work, /breezing, /fix-bug, /add-feature, --parallel, --merge. Do NOT load for: planning (use harness-plan), code review (use harness-review), release (use harness-release)."
description-ja: "Harness v5 統合実行 + merge orchestration ディスパッチャ。Plans.md 駆動で Auto Mode Detection (1件=Solo、2-3件=Parallel、4件以上=Breezing) しつつ、複数 PR の squash merge 局面を `--merge` flag / detect_merge_orchestration() シグナルで検知して `/harness-merge-train` に委譲。内部的に /tdd-implement v2 / /parallel-worktree v1 / /harness-merge-train (v5 で新設) に委譲することで TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオン (Phase 7) + Skill connectivity 原則 の完全品質ゲートを常時強制。以下で起動: 実装して、バグ修正、機能追加、複数 PR を merge、/harness-work、/work、/breezing、/fix-bug、/add-feature、--parallel、--merge。プランニング・レビュー・リリース・セットアップには使わない。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput", "Skill"]
argument-hint: "[all|task-number|N-M|PR-number|fix|feature|parallel|breezing|sequential|merge|no-commit|dry-run]"
---

# Harness Work (v5) — Plans.md 駆動 + merge orchestration ディスパッチャ

**v5 改修要旨 (2026-04-26)**: Step 2 モード判定に `merge` mode を追加し、複数 PR の squash merge orchestration を **`/harness-merge-train` (v5 で新設)** に委譲する経路を spec に明記。これで prior review で認識された「review/merge orchestration が dispatcher のスコープ外」spec gap を構造解消。**Skill connectivity 原則** (user / agent から直接 Bash / gh CLI で多 PR orchestration を実行するのは構造規律違反、skill 内部実装として gh / git を呼ぶのは設計) を v5 で固定する。v4 互換性 (solo / parallel / breezing / sequential / dry-run / fix-bug / add-feature) は破壊しない。

**v4 改修要旨 (2026-04-19)**: 内部委譲化。`/harness-work` はタスク抽出・モード判定・担当表更新の薄いディスパッチャに徹し、実装エンジンは `/tdd-implement` v2 (単一) / `/parallel-worktree` v1 (並列) に委譲。これで TDD + Codex チーム + 疑似 CodeRabbit + 本物 CodeRabbit + Codex セカンドオピニオンの完全品質ゲートが**常時強制**される。v3 以前で発覚した「worker agent が品質ゲート省略」問題の構造的解消 (詳細は CHANGELOG.md 参照)。

---

## Skill connectivity 原則 (v5 で固定)

> **user / agent から直接 Bash / gh CLI で多 PR orchestration / review / merge
> を実行するのは構造規律違反**。本 dispatcher と委譲先 skill の **内部実装** が
> `gh` / `git` を呼び出すのは設計 (skill が wrap する責務) であり、本節の原則
> と矛盾しない。
>
> | 作業領域 | user / agent から呼ぶべき skill |
> |---|---|
> | 実装 task (Plans.md 駆動 / 単発) | `/harness-work` → `/tdd-implement` v2 / `/parallel-worktree` v1 |
> | **merge orchestration (複数 PR squash merge)** | **`/harness-work` (`--merge`) → `/harness-merge-train` (v5 で新設)** |
> | 単一 feature → dev/main の linear merge | `/branch-merge` (本 dispatcher のスコープ外) |
> | Real CR 単一 PR (Stop polling + Merge ready 2 段判定) | **`/coderabbit-review` 必須経由、独自 polling 禁止** (`gh api ... reviews` / `commits/.../status` 直叩きは skill bypass) |
> | Pseudo CR (push 前) | `/pseudo-coderabbit-loop --local` |
> | Codex セカンドオピニオン | `/codex-team` |
> | Codex 並列実装 / 検証 | `harness:codex-sync` agent |
> | handoff 管理 | `/session-handoff` (init / update / archive / check) |
>
> skill が未存在の作業領域は **「spec ギャップ」** と認識し新 skill 設計を優先
> する。**user / agent からの手動 rebase / 手動 force-push / 手動 squash merge
> 等の skill bypass は consumer-side discipline ledger に append-only 自動追記**
> する (consumer プロジェクトが `harness.config.json` の
> `qualityGates.disciplineLedgerPath` で ledger path を宣言する想定)。緊急避難
> は許容するが透明性確保 (隠蔽撲滅) を最優先する。

---

## 基本原則（鉄則）

1. **Plans.md 駆動**: タスク抽出 / 担当表更新 / 状態管理が主責務
2. **実装委譲**: 実装そのものは `/tdd-implement` v2 or `/parallel-worktree` v1 に必ず委譲
3. **品質ゲート常時強制**:
   - TDD (Red → Green → Refactor)
   - Codex チーム並列 (worker + reviewer)
   - 公式ドキュメント確認は Codex 経由
   - 疑似 CodeRabbit pre-review (Phase 5.5)
   - 本物 CodeRabbit レビューループ (Phase 6)
   - Codex セカンドオピニオン (Phase 7)
4. **worktree 並列でも単一リポジトリでも対応**: Auto Detection、プロジェクト設定尊重
5. **全プロジェクト汎用**: `harness.config.json` / `Plans.md` / `.coderabbit.yaml` / `CLAUDE.md` / `AGENTS.md` から自動判定
6. **妥協禁止**: 「時間がない」「基盤が無い」を理由に品質ゲートを外さない

---

## Quick Reference

| ユーザー入力 | モード | 委譲先 |
|---|---|---|
| `/harness-work` | **auto** | タスク数で `/tdd-implement` or `/parallel-worktree` |
| `/harness-work all` | **auto** | 全未完了タスクで自動判定 |
| `/harness-work 3` | solo | `/tdd-implement` v2 (task #3 のみ) |
| `/harness-work 3-5` | parallel | `/parallel-worktree` (task #3-5) |
| `/harness-work --fix <説明>` | fix-bug | 一時タスク追加 → 自動モード |
| `/harness-work --feature <機能名>` | add-feature | 一時タスク追加 → 自動モード |
| `/harness-work --parallel N` | parallel (強制) | `/parallel-worktree --max-parallel=N` |
| `/harness-work --breezing` | breezing (強制) | `/parallel-worktree` with all remaining |
| `/harness-work --sequential` | sequential | `/tdd-implement` v2 を逐次 |
| `/harness-work --dry-run` | dry-run | モード判定 + 委譲プラン表示のみ |

---

## Auto Mode Detection (v2: 依存グラフ考慮)

**単純な件数ではなく「独立グループ数」で判定**する (Turbo 流 DAG 先行)。`depends_on` 付きの連鎖タスクは 1 グループとして数える。

> **実装状況 (harness-work v4 現行)**: 現在の harness-work v4 実装は「**件数ベース判定** (task count = 1 / 2-3 / 4+)」で Solo / Parallel / Breezing を選ぶ簡易版。以下に示す **依存グラフ** (`depends_on` DAG) / **`wt:*` worktree ラベル** 判定は **spec only** で、実体化は **Phase 2 スコープ** (Model B 実戦投入後)。暫定運用では:
> - 独立性 / 依存性は coordinator (人間 or Claude) が Plans.md を読んで判断
> - `wt:avoid` ラベルは `/harness-work --sequential` で明示強制
> - `wt:recommended` ラベルが付いたタスクは default で worktree 経路に載る
>
> 完全な DAG 判定は Claude Agent SDK or dedicated Python/TS parser で実装予定 (次セッション以降)。

### Step 0a — Session orient (`/session-handoff check` 必須実行、v4.3 追加)

**重要**: Step 0b (タスクソースの判定) より前に、必ず `/session-handoff check`
を実行してセッション再開可否を 3-gate (構造 + 内容把握 + 再開判定) で確認する。

| 結果 | 次のアクション |
|---|---|
| `PASS` | そのまま Step 0b へ進む |
| `WARN` | 出力に並ぶ staleness signal を確認、軽微なら進む / 重大 (S-12 / S-13 等) は事前に解消 |
| `FAIL` | `/session-handoff update` または `/session-handoff archive` で先に修正、再 check が `PASS` / `WARN` になってから Step 0b |
| `INIT_REQUIRED` | `/session-handoff init` を案内 (handoff 構造が未整備) |

`harness-work-essence` 不変条件 #3 (引継資料から最優先タスクを確認、構造化チームを編成) と #11 (諦めない / 妥協しない) を含む 13 項目の workflow contract は `docs/harness-work-essence.md` 参照。`harness.config.json` の `work.qualityGates.enforceHarnessWorkEssence: true` を設定すると、stop hook が turn 境界で同 contract の bird's-eye reminder を additionalContext として注入する (default-off、明示的 opt-in)。

#### Project pipeline addendum (opt-in)

`harness.config.json` の `work.pipelineCheckPath` がプロジェクト相対パスとして
宣言されている場合、その markdown を **pipeline 検証 addendum** として読み込み、
stack-neutral な built-in checks に上乗せする (例: project-local skill が提供する
pipeline-check.md / SKILL.md reference)。未設定なら addendum なしで built-in
checks のみ動く。

宣言例:

```jsonc
{
  "work": {
    "pipelineCheckPath": ".claude/skills/<project>-local-rules/references/pipeline-check.md"
  }
}
```

検証 (`validateWorkPipelineCheckPath`):
- 絶対パス・`..` セグメント・空文字・制御文字は **load 時に reject** され
  `undefined` にフォールバックされる (stderr に warning)
- 不正値時は addendum なしで built-in checks のみ動く (fail-open)
- skill / agent はこの field を直接読まず、必ず `loadConfig()` 経由で読む
  (path validation が一段で済む)

### Step 0b — タスクソースの判定 (4 層 handoff 対応、v4.2 追加)

依存グラフ判定の前に、まず**どこからタスクを取り出すか**を決定する。`harness.config.json`
の `work.taskTrackerMode` を読み、handoff モードの場合は backlog parser、
plans モードの場合は従来の `Plans.md` 経路を使う。

**判定フロー**:

```text
1. harness.config.json を読み込み (`work.taskTrackerMode`)
   ├─ "handoff" + work.handoffPaths.backlog 設定済
   │    → parseBacklog(handoffPaths.backlog) で BacklogEntry[] を取得
   │      (`plugins/harness/core/src/work/backlog-parser.ts`)
   │
   └─ "plans" (default) または config 未設定
        → 従来の Plans.md 経路 (work.plansFile = "Plans.md") を使う
```

**handoff モードの設定例** (project-local `harness.config.json`):

```json
{
  "work": {
    "taskTrackerMode": "handoff",
    "handoffPaths": {
      "roadmap":   ".docs/handoff/<project>-roadmap.md",
      "backlog":   ".docs/handoff/<project>-backlog.md",
      "current":   ".docs/handoff/<project>-current.md",
      "decisions": ".docs/handoff/<project>-design-decisions.md"
    }
  }
}
```

**handoffPaths が不完全 / 不正値**だった場合、loader (`config.ts`) が stderr
警告を出して silent fallback で `taskTrackerMode = "plans"` に降格する。
`/harness-work` は降格後の値を信頼してよい (loader が `handoffPaths` 未定義の
ままで handoff モードに残ることはない)。

#### Handoff Mode Tasks (handoff モードのタスク取り出し)

`parseBacklog()` の戻り値 `BacklogEntry` は次の構造を持つ:

```typescript
interface BacklogEntry {
  id: string;                                      // heading or YAML override
  priority: "Critical" | "High" | "Med" | "Low";   // dispatcher ordering
  status: "pending" | "in_progress" | "review" | "done";
  title: string;
  roadmapRef?: string;                             // pointer into roadmap.md
  worktree?: string;                               // 既に走っている worktree path
  pr?: string;                                     // 関連 PR
  rawHeading: string;
  lineNumber: number;
}
```

**dispatcher が `BacklogEntry[]` から実装対象を選ぶアルゴリズム**:

1. `status === "pending"` のものだけを対象に絞る (in_progress / review / done は除外)
2. `priority` で安定ソート (Critical → High → Med → Low、同 priority 内は file order を維持)
3. 上から `--parallel N` 件 (auto detection の場合は task 数で Solo/Parallel/Breezing 判定)
4. 各 entry の `worktree` 既設定があれば再利用、無ければ新規 worktree 作成
5. `roadmapRef` を `roadmap.md` に解決して AC / depends_on / estimated を取得
   (Phase 2 スコープ、現行 v4.2 では handoffPaths.roadmap の存在確認のみ)

**Plans.md mode (legacy)**: 既存ロジックを変更せず、`Plans.md` 担当表 + assignmentSectionMarkers
で抽出する従来経路を継続。**zero-diff for existing users**。

#### Maintainer-mode (meta-session) use case

harness plugin **自身の改修 session (meta-session)** で `/harness-work` を使うには、
plugin repo (例: `~/.claude/plugins/marketplaces/<plugin-name>/`) に
`harness.config.json` を置き、`work.taskTrackerMode = "handoff"` を宣言する。
これにより既存の handoff mode が **そのまま maintainer use case として機能** する。

**設定例** (plugin `harness.config.json`):

```jsonc
{
  "work": {
    "taskTrackerMode": "handoff",
    "handoffPaths": {
      "roadmap":   "docs/maintainer/ROADMAP-<scope>.md",
      "backlog":   "docs/maintainer/BACKLOG-<scope>.md",
      "current":   "docs/maintainer/CURRENT-<scope>.md",
      "decisions": "docs/maintainer/DECISIONS-<scope>.md"
    }
  }
}
```

これにより `/harness-work` は plugin の **maintainer task** を `parseBacklog()` で
抽出し、Auto Mode Detection (Solo / Parallel / Breezing) を適用、`/tdd-implement`
v2 / `/parallel-worktree` v1 に委譲する。Plans.md 駆動 (consumer 側) と
完全対称、新 flag は不要 (既存 `taskTrackerMode` config field で同等以上の制御が可能)。

**意図的に project-specific flag (例: `--<project-name>-mode` 形のような naming)
を新設しない理由**:
- 既存 `taskTrackerMode = "handoff"` で同等以上の制御が可能
- project-specific flag naming は **R2 (内部識別子 leak) 違反リスク** が高い
- generic config field (`taskTrackerMode`) であれば全 consumer / maintainer で再利用可能

generality CI test pattern **B-3g** が `--<project-name>-mode` 形の
project-specific flag naming が plugin shipped spec に混入することを CI 段階で
block する (将来 leak 予防の forcing function)。具体的 block 対象 list は
`plugins/harness/core/src/__tests__/generality.test.ts` の B-3g pattern
定義を参照。

#### Step 0 が確定する dispatch source は以降の全 step に適用される (重要)

Step 0 で得た **dispatch source** (Plans.md path もしくは BacklogEntry[]) と **mode tag** (`plans` / `handoff`) は、以降の **Pre-flight / Step 1 / Step 3 / Step 5 / state-update** すべてで参照される。各 step は次のアダプタ規約に従う:

| step | Plans-mode 動作 | Handoff-mode 動作 |
|---|---|---|
| **Pre-flight** | Plans.md 担当表 / assignmentSectionMarkers を読む | `current.md` 担当表セクション (handoffPaths.current) を読む |
| **Step 1 タスク抽出** | Plans.md から `[label]` 行を抽出 | `BacklogEntry[]` から `status === "pending"` を抽出 (priority ソート + file order tie-break) |
| **Step 3 担当表更新** | Plans.md 担当表に `status=in_progress` 行追加 | `current.md` 担当表 + `backlog.md` の対象 entry の YAML `status` を `in_progress` に書換 (append-only `decisions.md` は触らない) |
| **Step 5 完了処理** | Plans.md 担当表から行削除 + `## 完了` セクションへ追記 | `current.md` 担当表から行削除 + `backlog.md` の entry を `status: done` (もしくは entry 削除 + 完了 archive 切出) + `archive/session-<date>-<slug>.md` 自動 trigger 連携 |
| **state-update logic** | Plans.md 直接 edit | `parseBacklog()` 結果 → 編集箇所特定 → BacklogEntry 単位で書換 |

dispatcher / state mutation を行うコードは **両 task 形式を accept する adapter** を実装するか、あるいは **mode tag で early branch** する。`work.taskTrackerMode === "handoff"` だが `handoffPaths` が無効なケースは loader が `plans` に降格させるため、Step 1 以降が undefined dispatch source を見ることはない。

未対応の旧コードパス (Plans.md 直書き hardcode 等) があれば Step 0 で警告を出し、`taskTrackerMode === "plans"` のときに限定して動作させる (handoff mode では skip)。

### 判定フロー (v5: merge mode 最優先 → 既存 v4 経路)

```python
# Step 1: Plans.md から対象タスクを抽出、depends_on で DAG 構築
groups = compute_independent_groups(selected_tasks)
n_groups = len(groups)

# Step 2: wt:* ラベルで worktree 使用可否を決定
wt_labels = {task.wt_label for task in selected_tasks}

# Step 3: モード選択 (v5: merge mode が最優先で評価される)
if args.dry_run: mode = "dry-run"
elif args.merge or detect_merge_orchestration(args, plans_md, backlog_md):
    # v5 新規: 複数 PR の squash merge orchestration → /harness-merge-train に委譲
    mode = "merge"
elif args.breezing: mode = "breezing"
elif args.parallel: mode = "parallel-forced"
elif args.sequential: mode = "sequential"
elif "wt:avoid" in wt_labels and "wt:recommended" not in wt_labels:
    # wt:avoid 混在、worktree 使えない
    if n_groups <= 1: mode = "solo"
    elif n_groups <= 3: mode = "parallel-agent-tool"  # Agent ツールで並列 (公式 tool 名、旧称 Task)
    else: mode = "breezing-phase-fanout"              # Turbo 流 Phase fan-out
else:
    # worktree 利用可
    if n_groups == 0: mode = "no-task"
    elif n_groups == 1: mode = "solo"                 # -> /tdd-implement v2
    elif n_groups <= 3: mode = "parallel-worktree"    # -> /parallel-worktree
    else: mode = "breezing-worktree"                  # -> /parallel-worktree (cap 4)
```

#### `detect_merge_orchestration()` シグナル定義 (v5)

以下 4 シグナルのいずれか成立で merge mode と判定する (OR 条件):

```python
def detect_merge_orchestration(args, plans_md, backlog_md) -> bool:
    # Signal 4 を最初に評価 (明示意図、最強)
    # `--merge` flag が明示指定 (args.merge は本関数の caller で既に評価済、保険)
    if getattr(args, "merge", False):
        return True

    # Signal 1: 引数 PR 番号 ≥ 2 (positional 数字 token を 2 件以上含む)
    pr_args = [tok for tok in args.positional if tok.isdigit()]
    if len(pr_args) >= 2:
        return True

    # Signal 2: handoff backlog の Top Priority に merge orchestration を示す keyword あり
    backlog_text = read_optional(backlog_md)
    merge_keywords = ["merge orchestration", "Clear 判定 + merge", "PR merge",
                      "squash merge", "merge train", "/harness-merge-train"]
    if any(kw in backlog_text[:3000] for kw in merge_keywords):  # Top Priority 領域
        return True

    # Signal 3: gh pr list --state=open で自分の open PR ≥ 2 件、かつ全て CI green
    # **default opt-out** (config で work.allowMergeAutoSignal3 == True のとき限定)
    # 理由: 通常開発で複数 open PR が存在する状態は普通であり、自動 merge mode は
    #       既存 mode (solo / parallel / fix) を意図せず破壊する false-trigger リスク高。
    #       明示 opt-in した repo のみで Signal 3 を有効化する。
    if config_bool("work.allowMergeAutoSignal3", default=False):
        open_prs = gh("pr", "list", "--state=open", "--author=@me", "--json=number,statusCheckRollup")
        green_open = [pr for pr in open_prs if all_checks_green(pr)]
        if len(green_open) >= 2:
            # 追加 guard: positional / --fix / --feature が一切ない
            # (実装意図のある起動を merge にルートしない、最後の防波堤)
            if not args.positional and not args.fix and not args.feature:
                return True

    return False
```

`detect_merge_orchestration()` の出力は **opt-in/opt-out** に従う:
`harness.config.json` の `work.allowMergeMode` (default `true`) が `false` のとき、
全シグナル成立でも merge mode 判定を skip し v4 互換経路を取る。Signal 3 のみ
更に保守的な default opt-out (`work.allowMergeAutoSignal3` default `false`)。

### モード対応表

| 独立グループ数 | wt ラベル | 自動選択 | 委譲先 |
|---|---|---|---|
| 0 | — | 報告のみ | — (`/harness-plan` 提案) |
| 1 | wt:avoid | **Solo (avoid)** | `/tdd-implement` v2 直接 |
| 1 | wt:recommended | **Solo (worktree)** | `/parallel-worktree --max-parallel=1` (縮退モード) |
| 2-3 | wt:avoid | **Parallel (Agent tool)** | Agent ツール N 個 + TDD 強制節埋込 |
| 2-3 | wt:recommended | **Parallel (worktree)** | `/parallel-worktree --max-parallel=N` |
| 4+ | wt:avoid | **Breezing (Phase fan-out)** | Turbo 流: 独立グループ → 依存グループの 2 相並列 |
| 4+ | wt:recommended | **Breezing (worktree)** | `/parallel-worktree --max-parallel=min(N,4)` |

### Phase fan-out パターン (wt:avoid Breezing)

wt:avoid タスクが 4+ で worktree 使えない場合、Turbo 流に**位相分離**して並列化:

```
Phase A: 独立タスク群 (depends_on=[]) を Agent ツール並列
  ├─ Agent A1 (TDD 強制節埋込)
  ├─ Agent A2 (TDD 強制節埋込)
  └─ Agent A3 (TDD 強制節埋込)
      ↓ 全完了まで同期
Phase B: 依存タスク群 (depends_on=[A1,A2]) を並列
  ├─ Agent B1 (TDD 強制節埋込)
  └─ Agent B2 (TDD 強制節埋込)
      ↓
全完了後 Coordinator が Plans.md 一括更新 + cross-task Reviewer レビュー 1 回
```

**`fail-fast` 相当**: `[critical]` / `[security]` ラベルタスクが 1 件失敗 → Phase 全体停止、他タスク中断。

### 並列度の動的決定

`--parallel N` や Breezing モードの既定並列度は以下で決定:

```
N = min(
  タスク数,
  harness.config.json:work.maxParallel || 4,   # 明示設定優先
  CODEX_CLI_CONCURRENCY || 4,                   # Codex 同時実行制約
  CODERABBIT_BUCKET_SIZE || 5                   # CodeRabbit Pro rate limit (5/h)
)
```

ユーザー明示 `--parallel N` は上書き可能 (ただし警告表示)。

### worktree 使用判定

Auto mode で worktree を使うかの判定:

1. `harness.config.json` に `worktree.enabled == false` → Solo モード強制 (`/tdd-implement` v2 逐次)
2. `Plans.md` に `wt:avoid` ラベル付きタスクが選ばれた → そのタスクだけ Solo
3. `wt:coordination` ラベル → coordinator 事前調整ログを出力してから並列
4. それ以外 → worktree 並列 (`/parallel-worktree`)

---

## オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `all` | 全未完了タスクを対象 | - |
| `N` or `N-M` | タスク番号/範囲指定 | - |
| `--fix <説明>` | バグ修正フローを起動 (一時タスク追加) | - |
| `--feature <機能名>` | 機能追加フローを起動 (一時タスク追加) | - |
| `--parallel N` | 並列ワーカー数を強制指定 | auto |
| `--sequential` | 直列実行強制 (Solo を逐次) | - |
| `--breezing` | Parallel 強制 + 全未着手タスク対象 | false |
| `--no-commit` | 自動コミット抑制 | false |
| `--dry-run` | モード判定 + 委譲プランのみ表示 | false |
| `--affected` | **NEW (Nx 流)**: `git diff origin/<base>..HEAD` で変更ファイルを取得、Plans.md タスクの `touched_files` と照合して「影響タスクセット」のみ対象 | false |

**deprecation 通知**:
- 旧 `--codex` フラグは廃止予定。`/tdd-implement` v2 / `/parallel-worktree` が常に Codex チームを呼ぶため不要

---

## ワークフロー

### Pre-flight (全モード共通)

```bash
# 1. プロジェクト状態確認
git status --short
git log --oneline -3

# 2. Task source 存在確認 (taskTrackerMode で分岐)
#    handoff モードでは Plans.md ではなく handoffPaths.backlog / handoffPaths.current を見る。
#    config 読込失敗 / 未設定 / 値が "plans" なら従来の Plans.md 経路に降格 (zero-diff for legacy users)。
TRACKER_MODE=$(test -f harness.config.json && jq -r '.work.taskTrackerMode // "plans"' harness.config.json 2>/dev/null || echo "plans")
case "$TRACKER_MODE" in
  handoff)
    BACKLOG=$(jq -r '.work.handoffPaths.backlog // ""' harness.config.json 2>/dev/null || echo "")
    test -n "$BACKLOG" && test -f "$BACKLOG" \
      && echo "handoff backlog found: $BACKLOG" \
      || echo "handoff backlog missing — fall back to /tdd-implement directly (or fix work.handoffPaths)"
    CURRENT=$(jq -r '.work.handoffPaths.current // ""' harness.config.json 2>/dev/null || echo "")
    test -n "$CURRENT" && test -f "$CURRENT" \
      && echo "handoff current found: $CURRENT (担当表 source)" \
      || echo "handoff current missing"
    ;;
  *)
    test -f Plans.md && echo "Plans.md found" || echo "Plans.md missing — use /tdd-implement directly"
    ;;
esac

# 3. harness.config.json 読込 (プロジェクト設定)
test -f harness.config.json && cat harness.config.json | jq '.work // {}'

# 4. .coderabbit.yaml 存在確認 + profile 読取り
#    `pseudo-coderabbit-loop` と同じ 3 段フォールバック + WARN 出力 (silent 降格禁止)
PROFILE=""
if [ -f .coderabbit.yaml ]; then
  if command -v yq >/dev/null 2>&1; then
    PROFILE=$(yq '.reviews.profile // ""' .coderabbit.yaml 2>/dev/null || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    PROFILE=$(python3 -c "
import yaml
d = yaml.safe_load(open('.coderabbit.yaml'))
print(d.get('reviews', {}).get('profile', '') if isinstance(d, dict) else '')
" 2>/dev/null || true)
  fi
  if [ -z "$PROFILE" ] && command -v python3 >/dev/null 2>&1; then
    # pseudo-coderabbit-loop と同じロジック、同じ quoted heredoc で bash エスケープ依存排除。
    # 末尾の `(?:\s+#.*)?` は valid YAML の inline comment を許容する。
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
echo "CodeRabbit profile from .coderabbit.yaml: $PROFILE"

# YAML 由来の PROFILE は CodeRabbit 公式 allowlist (chill / assertive) のみ許可。
# strict は harness-local extension で CLI / harness.config.json 専用、YAML 経路では採用しない
# (https://docs.coderabbit.ai/reference/configuration 公式 schema 準拠)。
if [ -n "$PROFILE" ] && [ "$PROFILE" != "chill" ] && [ "$PROFILE" != "assertive" ]; then
  echo "WARN: .coderabbit.yaml profile='$PROFILE' is outside CodeRabbit official allowlist (chill / assertive); fallback to 'chill' (use --profile=strict or harness.config.json for local extension)" >&2
  PROFILE="chill"
fi

# PROFILE 値の優先順位 (高 → 低):
#   1. コマンド引数 `--profile=...` (`$ARGUMENTS` を argv 単位で case 文完全一致抽出)
#   2. `harness.config.json` の `.tddEnforce.pseudoCoderabbitProfile`
#   3. `.coderabbit.yaml` の `reviews.profile` (上記 3 段 fallback + 公式 allowlist 検証済)
#   4. `chill` (最終 fallback、WARN 出力付き)
# 後段 (Phase 5.5) にはここで確定した値を Skill handoff 時に **実値へ materialize** してから渡す
# (Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` (0-based、`$0` が第1引数) のみ保証。`${PROFILE}` は
# undocumented なので、coordinator が Skill 呼出前に literal `${PROFILE}` を `chill` 等に置換する責務)。
#
# Shell 互換 (bash 必須): `read -r -a` / 配列 0-based / `unset 'arr[idx]'` は bash 拡張で、
# zsh / dash / POSIX sh では silent に degrade する。BASH_VERSION を明示確認して fail-fast。
# Claude Code の Bash tool は通常 /bin/bash で実行されるため本 guard は保険。
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: /harness-work argv parser requires bash (BASH_VERSION unset)." >&2
  echo "       手動実行時は 'bash -c \"/harness-work ...\"' で包んでください。" >&2
  exit 1
fi
# zsh で呼ばれた場合の最後の保険 (exec 失敗しても BASH_VERSION check で既に停止済)。
[ -n "${ZSH_VERSION:-}" ] && emulate -L bash

# argv 単位の case 文完全一致 + 末尾 token 限定: `--profile=strict1` / `--profile=chill-something` を誤受理せず、
# かつ task description 本文の `--profile=assertive` 的な引用文言を option と誤認しない。
ARG_PROFILE=""
# $ARGUMENTS を配列に読み込み (bash の word splitting を明示)。
# 空白を含む値 (例 `--foo="bar baz"`) は未サポート。
read -r -a ARGS_TOKENS <<< "$ARGUMENTS"
LAST_IDX=$((${#ARGS_TOKENS[@]} - 1))
if [ "$LAST_IDX" -ge 0 ]; then
  LAST_TOK="${ARGS_TOKENS[$LAST_IDX]}"
  case "$LAST_TOK" in
    --profile=chill|--profile=assertive|--profile=strict)
      ARG_PROFILE="${LAST_TOK#--profile=}"
      ;;
    --profile=*)
      echo "WARN: invalid --profile='${LAST_TOK#--profile=}' (must be chill|assertive|strict); ignored" >&2
      ;;
  esac
fi

# 末尾以外の --profile= は WARN 出す (CodeRabbit PR #1 回帰防止):
# 旧実装は全 token scan だったため、`/harness-work --profile=assertive T-12` のような並びが
# 許容されていた。末尾限定に変えたことで silent ignore するのを防ぐため、中間位置の
# --profile= を検出時に明示 WARN する。
for i in "${!ARGS_TOKENS[@]}"; do
  if [ "$i" != "$LAST_IDX" ]; then
    case "${ARGS_TOKENS[$i]}" in
      --profile=*)
        echo "WARN: --profile='${ARGS_TOKENS[$i]#--profile=}' at position $i is ignored; only the LAST token is parsed as --profile= option." >&2
        ;;
    esac
  fi
done

# harness.config.json key path は実装とドキュメントを `.tddEnforce.pseudoCoderabbitProfile` に統一。
# JSON 破損時は WARN を出して silent fallback を避ける。
# 取得値は allowlist 検証してから採用する (typo や非公式値が downstream に流れないよう)。
CFG_PROFILE=""
if [ -f harness.config.json ] && command -v jq >/dev/null 2>&1; then
  if ! jq empty harness.config.json 2>/dev/null; then
    echo "WARN: harness.config.json is not valid JSON; skipping config-level profile override" >&2
  else
    CFG_PROFILE_RAW=$(jq -r '.tddEnforce.pseudoCoderabbitProfile // empty' harness.config.json 2>/dev/null || true)
    case "$CFG_PROFILE_RAW" in
      chill|assertive|strict)
        CFG_PROFILE="$CFG_PROFILE_RAW"
        ;;
      "")
        : # empty はそのまま (no override)
        ;;
      *)
        echo "WARN: harness.config.json .tddEnforce.pseudoCoderabbitProfile='$CFG_PROFILE_RAW' is not in allowlist (chill|assertive|strict); ignored" >&2
        ;;
    esac
  fi
fi

PROFILE="${ARG_PROFILE:-${CFG_PROFILE:-$PROFILE}}"
export PROFILE
echo "Resolved profile (arg > config > yaml > chill): $PROFILE"

# --no-commit flag 抽出 (parallel 経路への伝播規約)。
# 位置は任意 (末尾 token の --profile= と並ばない、--no-commit 単独で末尾に来ることもある)
# なので全 token scan で拾う。Plans.md 駆動で自動 commit を抑制したいケース (CodeRabbit 反復時 /
# 手動レビュー前の段階的確認) で使う。
NO_COMMIT=""
for tok in "${ARGS_TOKENS[@]}"; do
  case "$tok" in
    --no-commit) NO_COMMIT="--no-commit" ;;
  esac
done
export NO_COMMIT
echo "NO_COMMIT: ${NO_COMMIT:-<not set>}"

# Handoff 規約 (Skill / Agent tool いずれでも同じ):
# coordinator が解決した $PROFILE / $NO_COMMIT を **materialize して** downstream に渡す。
# 例 (Solo → /tdd-implement):
#   `/tdd-implement ${TASK_ID} --profile=${PROFILE} ${NO_COMMIT}`
#   → materialize 後:
#   `/tdd-implement T-12 --profile=assertive --no-commit`  (NO_COMMIT 有)
#   `/tdd-implement T-12 --profile=assertive`              (NO_COMMIT 無)
# 例 (Parallel/Breezing → /parallel-worktree):
#   `/parallel-worktree <tasks> --profile=${PROFILE} ${NO_COMMIT}`
#   → materialize 後:
#   `/parallel-worktree T-12,T-13 --profile=strict --no-commit`
# どちらも NO_COMMIT が空なら末尾 flag を付けない (空 token で handoff しない)。

# 5. Codex CLI 利用可能性
codex --version 2>/dev/null || echo "WARNING: Codex CLI not installed — /tdd-implement v2 Phase 4-5 will skip Codex"
```

**Pre-flight に失敗したら**: 原因を報告、適切な代替スキル (`/tdd-implement` 直接 / `/harness-plan` 先行 等) を提案。

---

### Step 1: タスク抽出 + 優先度ソート

#### Plans-mode (default、`taskTrackerMode = "plans"`)

Plans.md の「未着手」セクションを parse し、以下の優先順位でソート:

1. `[fix]` — バグ修正 (最優先)
2. `[security]` — セキュリティ修正
3. `[improve]` — 機能改善
4. `[feature]` — 新機能
5. `[refactor]` — リファクタリング
6. `[test]` — テスト追加
7. `[docs]` — ドキュメント

引数の絞込:
- `N` 単体 → そのタスクのみ
- `N-M` → 範囲
- `all` → 全未着手
- `--fix <説明>` / `--feature <機能名>` → 一時タスクを Plans.md に追加してから抽出

#### Handoff-mode (`taskTrackerMode = "handoff"`)

`parseBacklog(handoffPaths.backlog)` で `BacklogEntry[]` を取得し、以下の手順で対象を絞る (`Plans.md` は読まない):

1. `status === "pending"` のみを抽出 (in_progress / review / done は除外)
2. `priority` で安定ソート (Critical → High → Med → Low、同 priority 内は file order を維持)
3. `[fix]` / `[security]` 等の label tag が heading title 文字列に含まれる場合は priority 内で更に上位に並べる (Plans-mode と同じ label 順を tie-break として保つ)

引数の絞込:
- `<id>` 単体 → 当該 id の entry のみ (`BacklogEntry.id` 完全一致、未マッチなら no-task)
- `all` → `status === "pending"` 全件
- `--fix <説明>` / `--feature <機能名>` → 一時 entry を `backlog.md` に append (priority: High、status: pending) してから抽出

`BacklogEntry.roadmapRef` が設定されている場合は `handoffPaths.roadmap` を Read して対応セクションの AC / depends_on / estimated を取得 (v4.2 では存在確認のみ、Phase 2 で full integration)。

`work.handoffPaths` が無効 / 不完全だった場合は loader (`config.ts`) が stderr 警告を出して silent fallback で `taskTrackerMode = "plans"` に降格する。Step 1 が undefined dispatch source を見ることはない。

---

### Step 2: モード判定 (v5: merge mode 最優先で評価)

```python
if args.dry_run:
    mode = "dry-run"
elif args.merge or detect_merge_orchestration(args, plans_md, backlog_md):
    # v5 新規: 複数 PR の squash merge orchestration
    # → /harness-merge-train に委譲。Step 4.6 参照
    mode = "merge"
elif args.breezing:
    mode = "breezing"  # -> /parallel-worktree
elif args.parallel:
    mode = "parallel"  # -> /parallel-worktree --max-parallel=N
elif args.sequential:
    mode = "sequential"  # -> /tdd-implement を逐次
else:
    # Auto Detection (件数ベース、v4 互換、n_tasks == 1 / 2-3 / 4+ で分岐)
    n_tasks = len(selected_tasks)
    if n_tasks == 0: mode = "no-task"
    elif n_tasks == 1: mode = "solo"        # -> /tdd-implement v2
    elif n_tasks <= 3: mode = "parallel"    # -> /parallel-worktree
    else: mode = "breezing"                 # -> /parallel-worktree (並列度上限)

# worktree 非対応プロジェクト / wt:avoid タスクなら Solo に降格 (merge mode は不変)
if mode != "merge" and harness_config.worktree_enabled == False:
    mode = "sequential"
if mode != "merge" and any(task.has_label("wt:avoid") for task in selected_tasks):
    warn_and_downgrade_to_sequential()
```

**merge mode の `detect_merge_orchestration()` 4 シグナル** (詳細は前掲「判定フロー」section):

1. **PR 番号 ≥ 2** が positional 引数に含まれる (例: `/harness-work <pr-a> <pr-b> <pr-c>`)
2. **handoff backlog の Top Priority に merge keyword** あり ("merge orchestration" / "Clear 判定 + merge" / "/harness-merge-train" 等)
3. **`gh pr list --state=open` で自分の open PR ≥ 2 件**、かつ全て CI green
4. **ユーザー明示 `--merge` flag**

`harness.config.json` の `work.allowMergeMode == false` で全シグナル無効化可能 (default `true`)。

---

### Step 3: 担当表更新 (coordinator レイヤー)

#### Plans-mode (default)

Plans.md 担当表運用があるプロジェクトでは、実装開始前に以下を更新:

```markdown
## 現在進行中の worktree（担当表）
| task_id | owner | branch | worktree_dir | status | touched_files | 備考 |
|---|---|---|---|---|---|---|
| <task_id> | <mode>-worker | <branch> | <path> | in_progress | … | <任意メモ> |
```

Plans.md 未使用プロジェクトでは scoping comment / task file のみ作成。

#### Handoff-mode

`current.md` の担当表セクション + `backlog.md` の対象 entry の YAML metadata の両方を併用更新する。**`Plans.md` は触らない**:

1. **`current.md` 担当表更新** — `assignmentSectionMarkers` (default `["担当表", "Assignment", "In Progress"]`) で位置特定し、Plans-mode と同じ markdown 表形式で行を追加 (`status: in_progress`)
2. **`backlog.md` entry 更新** — 対象 entry 直下の fenced YAML block の `status` を `in_progress` に書換 (entry 削除でなく status 推移、heading は不変)
3. **`design-decisions.md` は触らない** — append-only invariant を守る (新規 design decision は Step 5 / archive 時に別途 append)

`current.md` に担当表セクションが存在しない場合 (新規 handoff プロジェクト) は、`assignmentSectionMarkers` の最初の値を H2 として末尾に追加してから行を書く。

---

### Step 4: モード別委譲

#### 4.1 Solo モード (1 タスク)

**重要: handoff 時は PROFILE を実値に materialize してから Skill を呼ぶ**。Anthropic 公式 slash command の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` (0-based、`$0` が第1引数) のみ保証 (https://docs.anthropic.com/en/docs/claude-code/slash-commands)。`${PROFILE}` は undocumented なので、literal のまま Skill に渡すと受け手側で literal として扱われ、委譲境界で PROFILE が失われる。

coordinator (LLM) は Pre-flight で確定した `$PROFILE` の **実値** を args 文字列内に直接埋め込んでから Skill を呼び出す責任を持つ:

```
# テンプレート表記 (<PROFILE> は spec 上のプレースホルダ、coordinator が実値を埋め込む)
Skill({skill: "tdd-implement", args: "<task description + AC + forbidden files> --profile=<PROFILE>"})

# 実際の呼出例 (coordinator が PROFILE=assertive を解決した場合)
Skill({skill: "tdd-implement", args: "<task description + AC + forbidden files> --profile=assertive"})
```

**禁止**: `--profile=${PROFILE}` (`${VAR}` 一般展開は公式未サポート) や `--profile=<PROFILE>` (placeholder のまま) を Skill args に literal で渡す (受け手側で置換されず literal として伝わる)。必ず実値 (chill / assertive / strict) を埋め込んでから呼ぶ。

`/tdd-implement` v2 が以下を完全実行:
- Phase 1 計画
- Phase 2 RED
- Phase 3 GREEN
- Phase 4 Codex 並列検証
- Phase 5 Codex レビューループ
- Phase 5.5 `/pseudo-coderabbit-loop --local --profile=$PROFILE`
- Phase 6 push + PR + `/coderabbit-review <pr>`
- Phase 7 `/codex-team` セカンドオピニオン

#### 4.2 Parallel / Breezing モード — worktree 利用可

**handoff materialize 必須** (4.1 と同じ原則)。coordinator は `$PROFILE` を実値に置換してから Skill を呼び出す:

```
# テンプレート表記 (<PROFILE> は spec 上のプレースホルダ)
Skill({skill: "parallel-worktree", args: "--max-parallel=<N> --feature-branch=<branch> --profile=<PROFILE> --spec=<inline-spec>"})

# 実際の呼出例 (PROFILE=strict の場合)
Skill({skill: "parallel-worktree", args: "--max-parallel=3 --feature-branch=feature/foo --profile=strict --spec=<inline-spec>"})
```

`/parallel-worktree` v1 が:
- N worktree 生成
- 各 worktree で `harness:worker` agent 起動、内部で `/tdd-implement` v2 強制実行
- coordinator が本物 CodeRabbit + マージ順序 + コンフリクト解消 + 担当表クリア

#### 4.2b Parallel (Agent tool) モード — wt:avoid 混在、worktree 使えない

`Agent` ツール (公式 tools-reference の `Agent`、旧称 `Task` は現行 catalog 未掲載) で N タスクを並列起動。各 Agent プロンプトには以下を必須埋込する:
- TDD 強制節
- **profile を materialize 済み実値で埋め込む** (Skill handoff と同じ規約)。`tdd_enforced_prompt(task)` を組み立てる段階で coordinator が `$PROFILE` を実値 (chill / assertive / strict) に置換してから Agent prompt 文字列に入れる。literal `$PROFILE` のまま渡すと subagent 側で slot 展開されず profile が失われる (Anthropic 公式の動的置換は `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` 0-based のみ保証)。

```markdown
本タスクは TDD + 品質ゲート必須。以下の Phase を省略なく実行:
- Phase 2 Red: 失敗テスト先行 (pytest 基盤なければ先に整備)
- Phase 3 Green: 最小実装 + 全既存テスト維持
- Phase 4 Codex 並列: `harness:codex-sync` agent を起動 or `codex exec` で差分突合
- Phase 5 Codex レビュー: critical/major が 0 になるまで反復
- Phase 5.5 疑似 CodeRabbit: `/pseudo-coderabbit-loop --local --profile=<実値>` で actionable=0 まで反復
  (coordinator が $PROFILE を解決した実値 = chill / assertive / strict に埋め込んでから prompt に渡す)
- Phase 6: push まで実施 (PR 作成は coordinator 実施)
省略した場合、完了報告に **「妥協あり」** と明記すること (本来は禁止)。
```

**実例** (coordinator が PROFILE=assertive を解決した場合の Phase 5.5 行):

```markdown
- Phase 5.5 疑似 CodeRabbit: `/pseudo-coderabbit-loop --local --profile=assertive` で actionable=0 まで反復
```

**Phase 4 Codex 並列の Agent tool 直接呼出例** (coordinator が `harness:codex-sync`
を spawn する場合、`name` 引数を必ず明示する。`SendMessage` resume + truncate
recovery の退避路を確保するため、codex-sync.md "Handling Mid-Response
Truncation" の要件に従う):

```text
Agent({
  subagent_type: "harness:codex-sync",
  name: "codex-sync-work-phase4",
  description: "Phase 4 Codex 並列検証",
  prompt: "Independent reviewer として task <id> 実装を verify..."
})
```

複数 task を Phase 4 で並列に走らせる場合は `<name>` を task / track 単位で
ユニーク化する (例: `codex-sync-work-phase4-task-3`)。

**注**: `harness:worker` は `disallowedTools: [Agent]` のため worker 内から更に subagent 起動不可 (`Agent` tool が公式 subagent spawn tool、`Task` 単独は公式 catalog 未掲載)。**TDD 強制は worker プロンプト本文で実現**する。

#### 4.2c Breezing (Phase fan-out) モード — wt:avoid 混在、4+ タスク

Turbo 流の位相分離:

```bash
# Phase A: 独立タスク群を Agent ツール並列 (全て TDD 強制節埋込)
coordinator_plans = compute_phases(tasks, dependencies)
for task in coordinator_plans["phase_a"]:
    Agent({description: task.title, prompt: tdd_enforced_prompt(task), run_in_background: true})

# 全 Phase A 完了まで同期

# Phase B: 依存タスク群を Agent ツール並列
for task in coordinator_plans["phase_b"]:
    Agent({description: task.title, prompt: tdd_enforced_prompt(task), run_in_background: true})

# 全完了後 coordinator が:
# - Plans.md 一括更新
# - cross-task Reviewer 1 回 (harness:reviewer agent)
```

#### 4.3 Sequential モード (明示 / worktree 非対応)

**handoff materialize 必須** (4.1 と同じ原則)。`$PROFILE` の実値を各 Skill 呼出の args に埋め込む:

```
# PROFILE=chill の場合の実際の呼出
for task in selected_tasks:
    Skill({skill: "tdd-implement", args: "<task desc> --profile=chill"})
    # 各タスク完了まで待機、次へ
```

#### 4.4 Test Pipeline モード

API 不使用のコストゼロパイプライン確認は本 skill 直下では実装しない。
project の test pipeline 検証 (依存関係 import / データディレクトリ存在 / 主要クラス import / 出力 artifact schema 等) は **project-local skill に完全委譲** する。canonical layout は以下のいずれか (どちらも有効、project の好みで選択):

- `<consumer>/.claude/skills/<project>-test-pipeline/` — 専用 skill ディレクトリ
- `<consumer>/.claude/skills/<project>-local-rules/references/pipeline-check.md` — local-rules skill 配下 reference (CHANGELOG v4.2 / `generality.test.ts` の commentary と整合する canonical example)

`harness.config.json` の `protectedDirectories` / `.claude/rules/*.md` で宣言された project 固有資産は、generic な harness core では schema を持ち得ないためである。

`/tdd-implement` への委譲も行わない (independent flow)。本モードを呼び出す場合、`/harness-work` は detection 後に project-local skill に直接 dispatch するのが通常経路。

#### 4.5 Dry-run モード

実装委譲しない。モード判定 + 委譲プラン + 影響範囲を表示:

```
Auto Mode Detection 結果:
  mode: parallel
  tasks: [#3, #5, #7]
  max_parallel: 3
  delegated_to: /parallel-worktree --max-parallel=3 --feature-branch=feature/xxx
  estimated_duration: 30-60 min
  worktrees_to_create: [wt-task-3, wt-task-5, wt-task-7]
  coderabbit_reviews: 3 件 (Pro rate limit 5/h 以内、OK)
```

#### 4.6 Merge mode (v5 新規) — `/harness-merge-train` に委譲

`mode == "merge"` のとき、複数 PR の squash merge orchestration を `/harness-merge-train` に委譲する。**handoff materialize 規約 (4.1 と同じ原則) は merge mode でも継承され、PROFILE / PR 引数は実値で渡す**。`${VAR}` 一般展開は Anthropic 公式 slash command で未サポート (`$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` 0-based + CLAUDE_* のみ保証) のため、coordinator は `<PROFILE>` placeholder を必ず実値 (chill / assertive / strict) に置換してから呼び出す。

**PR materialization 規約 (各シグナル別)**:

| 検出シグナル | PR args の構築方法 |
|---|---|
| Signal 1 (positional PR ≥ 2) | `args.positional` の数字 token を順序保持で渡す: `"<pr-a> <pr-b> <pr-c>"` |
| Signal 2 (handoff backlog merge keyword) | backlog から `pr:` field を抽出、PR 番号順にソート: `"<pr-a> <pr-b> <pr-c>"` |
| Signal 3 (open PR ≥ 2 + guard 通過) | `gh pr list --state=open --author=@me --json=number` の number array を昇順 |
| Signal 4 (`--merge` flag のみ) | `args.positional` から数字 token、または `--filter` 経由で動的 fetch |

```text
# テンプレート表記 (<PROFILE> は spec 上のプレースホルダ)
Skill({skill: "harness-merge-train", args: "<PR# ...> --profile=<PROFILE>"})

# 実際の呼出例 (PROFILE=assertive、PR を 3 件 merge する場合のテンプレート、coordinator が実 PR 番号を埋める)
Skill({skill: "harness-merge-train", args: "<pr-a> <pr-b> <pr-c> --profile=assertive"})

# --filter 経由 (positional 引数なしで自分の open PR を全件)
Skill({skill: "harness-merge-train", args: "--filter='.[] | select(.author.login==\"me\" and .state==\"OPEN\")' --profile=chill"})
```

`/harness-merge-train` (v5 で新設) が以下を完全実行:

- **M0 Pre-flight** (mergeable / CI / Clear 判定 / rate-limit marker)
- **M1 Rebase** (CONFLICTING 時、`origin/<base>` 基準 / dist auto-build conflict 解消 / source conflict は fail-fast)
- **M2 Pre-merge gate** (`harness:codex-sync` G4 + `/pseudo-coderabbit-loop --local` G5)
- **M3 Push** (`--force-with-lease` 推奨)
- **M4 CI wait** (Monitor で `gh pr checks` green まで)
- **M5 Real CodeRabbit Clear 判定** (`/coderabbit-review` G6、Step 7.4 マトリクス)
- **M6 Codex Phase 7** (`/codex-team adversarial` G7)
- **M7 Squash merge** (`gh pr merge --squash`)
- **M8 Worktree cleanup**
- **M9 Handoff sync** (`/session-handoff update` G8)
- 全 PR 完了後 **Loop exit ritual** (`/session-handoff archive` で session 単位 archive)

**fail-fast**: 任意 phase で失敗したら該当 PR で停止、残 PR は touch せず user に判断委譲。skill bypass / 規律違反検出時は **鉄則 7 ledger に append-only 自動追記** (`.claude/rules/implementation-workflow.md` 参照)。

詳細仕様 / 入力 / `--filter` / `--order` / `--dry-run` / `--max-iterations` / `--no-commit` 等の flags は `commands/harness-merge-train.md` 参照。

---

### Step 5: 完了確認 + 担当表クリア + 状態更新

全委譲完了後、coordinator が:

1. 委譲先からの完了報告を verify (commit hash / push / PR URL)
2. 品質ゲートが全て走った証跡を確認:
   - 各 worktree / 単一タスクで Phase 4 Codex 並列 ✅
   - Phase 5 Codex レビュー ✅
   - Phase 5.5 疑似 CodeRabbit clean ✅
   - Phase 6 本物 CodeRabbit Clear (APPROVED or unresolved=0) ✅
   - Phase 7 Codex セカンドオピニオン ✅
3. **省略されていた場合**: 該当タスク (Plans-mode なら Plans.md 担当表の task-id、Handoff-mode なら `BacklogEntry.id`) を引数にして `/harness-work <task-id>` を再 dispatch。`--resume` フラグは存在しない (本 skill の `argument-hint` を参照)、再 dispatch は通常の task-id 経路で行う。

   **task-id は single-token (空白不可)**: 本 skill の引数 parser は `read -r -a ARGS_TOKENS <<< "$ARGUMENTS"` で word splitting するため、Plans-mode 担当表の task-id / Handoff-mode `BacklogEntry.id` の双方で **空白文字を含まない単一 token** を必須とする。`argument-hint` の `[task-number|N-M|PR-number|...]` も同じ single-token 前提で書かれている (例: `T-001` / `42-44` / `pr-123`、空白入り ID は parser 不整合)。consumer 側 (Plans.md / backlog.md) の規約として ID 命名で空白を許さない設計を強制すること。

#### Plans-mode (default)

4. Plans.md 担当表から行削除 → 完了セクションに追記
5. worktree cleanup (`/parallel-worktree` が実施済)
6. プロジェクト固有のセッション引継ファイル (`harness.config.json` の `work.handoffFiles` 等で指定、存在すれば) を更新

#### Handoff-mode

4. `current.md` 担当表から行削除 + `backlog.md` の entry を `status: done` に書換 (heading 不変、entry 自体は archive 切出時に削除可)
5. `/session-handoff archive` を呼び出し `archive/session-<YYYY-MM-DD>-<slug>.md` に当該セッションの全 commit / design decision / open issue を切り出し (archive 内 footer に design-decisions.md への append 可否を ask)
6. worktree cleanup (`/parallel-worktree` が実施済)
7. `/session-handoff update` で `current.md` の Latest state / Top priority / Quick-start を最新化 (next session が即着手可能な状態に保つ)

#### Closing ritual (mode を問わず必須、v4.3 追加)

Plans-mode / Handoff-mode どちらでも、session の最後で**必ず**以下を実行する:

1. **Final report** — チェックリスト達成状況、計画 vs 実績、変更 file 一覧、留保点 (申送) を整理する。`harness-work-essence` 不変条件 #13 に対応。
2. **Handoff persistence** — プロジェクトが 4-layer handoff を採用している場合 (`.docs/handoff/` 等):
   - `/session-handoff archive` で当該セッションを archive 切出
   - `/session-handoff update` で `current.md` を次セッション着手用 snapshot に書換
3. **Plans.md fallback** — handoff 不採用プロジェクトでも、`Plans.md` の完了セクション + プロジェクト固有 handoff file (`harness.config.json` の `work.handoffFiles`) を最新化する

`harness.config.json` で `work.qualityGates.enforceHarnessWorkEssence: true` を設定しているプロジェクトは、stop hook が turn 境界で本 ritual の reminder (`[harness-work essence] ... 終了時 handoff archive+update`) を additionalContext として注入するので skip 検出が容易。詳細な workflow contract は `docs/harness-work-essence.md` 参照。

---

## サブフロー詳細

### `--fix` バグ修正 (旧 /fix-bug を統合)

1. Plans.md に一時タスク追加: `- [ ] [fix] <説明>（実装中）`
2. Auto Detection → Solo モード (単発タスクのため)
3. `/tdd-implement` v2 に委譲:
   - Phase 2 RED: バグ再現テストを先に書く (テスト駆動バグ修正)
   - Phase 3 GREEN: 最小修正で再現テスト pass
   - Phase 4-7: Codex + CodeRabbit レビューループ
4. Plans.md 更新 → 完了セクション

**禁止事項** (`/tdd-implement` v2 が強制):
- 根本原因特定前の対症療法
- 後方互換性破壊
- テスト削除・改ざん

### `--feature` 機能追加 (旧 /add-feature を統合)

1. Plans.md に一時タスク追加: `- [ ] [feature] <機能名>（実装中）`
2. Auto Detection → Solo or Parallel (複雑さによる)
3. `/tdd-implement` v2 / `/parallel-worktree` に委譲

**禁止事項**:
- スコープクリープ
- 既存 interface の破壊
- テストなしの複雑機能追加

---

## CI 失敗時の対応 (全モード共通)

1. CI ログを確認 → エラー原因特定
2. `/tdd-implement` v2 Phase 2-3 で修正 (RED → GREEN)
3. 同一原因で 3 回失敗 → 自動修正ループ停止、ユーザーにエスカレーション
4. 失敗ログ・試みた修正・残論点をまとめて報告

---

## プロジェクト設定 (`harness.config.json`)

全プロジェクト共通で以下のフィールドを推奨 (未設定なら既定値で動作):

```json
{
  "work": {
    "plansFile": "Plans.md",
    "maxParallel": 4,
    "labelPriority": ["fix", "security", "improve", "feature", "refactor", "test", "docs"],
    "criticalLabels": ["critical", "security", "fix"],
    "testCommand": "pytest -q",
    "qualityGates": {
      "enforceTddImplement": true,
      "enforcePseudoCoderabbit": true,
      "enforceRealCoderabbit": true,
      "enforceCodexSecondOpinion": true
    },
    "failFast": true
  },
  "worktree": {
    "enabled": "auto",
    "maxParallel": 4,
    "parentDir": "..",
    "prefix": "<project-name>-wt-",
    "defaultBaseBranch": "main",
    "forceDisableReasons": [
      "例: high-conflict collaboration phase (hot files concentrated)",
      "例: baseline migration 期間",
      "例: 全ファイル rename/削除タスク実行中"
    ]
  },
  "tddEnforce": {
    "alwaysRequireRedTest": true,
    "allowSkipOnDocsTasks": true,
    "pseudoCoderabbitProfile": "chill",
    "maxCodexReviewRetries": 3
  },
  "codeRabbit": {
    "botLogin": "coderabbitai",
    "ratelimitCheckWindowMinutes": 15,
    "approvedStateAsClear": true,
    "maxPseudoLoopIterations": 5,
    "proBucketSize": 5,
    "proBucketWindowMinutes": 60
  }
}
```

`qualityGates` で一部を無効化できるが、**既定は全て true**。プロジェクト固有の例外理由は `CLAUDE.md` / `AGENTS.md` に明記必須。

`worktree.forceDisableReasons` は**期間限定で手動制御**するエスケープハッチ。並列開発禁止期間を明示化できる (例: 大規模 rename 期間、migration 期間)。

---

## 既存互換 (Backward Compatibility)

v3 ユーザーへの移行:

| v3 の動作 | v4 の動作 |
|---|---|
| `--codex` 明示で Codex CLI 直接委託 | **非推奨**。`/tdd-implement` v2 が常に Codex 並列呼出 |
| Breezing モードで worker + reviewer agent 独自調整 | `/parallel-worktree` v1 に統合、各 worktree で `/tdd-implement` v2 強制 |
| Solo モードで worker agent 直接 | `/tdd-implement` v2 に委譲 (品質ゲート強化) |

v3 のコマンド互換は維持される (`--parallel N` / `--breezing` / `--fix` / `--feature` は動く)。ただし内部動作が委譲型に変わる。

---

## 禁止事項 (絶対守る)

- `/tdd-implement` v2 / `/parallel-worktree` v1 を経由せず worker agent を直接 dispatch する
- 品質ゲート (Phase 4/5/5.5/6/7) のいずれかを省略する
- Plans.md を leaf worktree で編集する (coordinator 専任)
- `harness.config.json` の `qualityGates` を勝手に false にする (プロジェクト憲章への違反)

---

## 関連スキル

| スキル | 役割 | 呼び出し関係 |
|---|---|---|
| `/tdd-implement` v2 | 単一タスク実装エンジン (primitive) | `/harness-work` Solo / Sequential が呼ぶ |
| `/parallel-worktree` v1 | worktree 並列オーケストレータ | `/harness-work` Parallel / Breezing が呼ぶ |
| **`/harness-merge-train` v1** (v5 で新設) | **複数 PR squash merge orchestrator (M0-M9 phase chain)** | **`/harness-work` v5 Merge mode が呼ぶ** |
| `/pseudo-coderabbit-loop` | 疑似 CodeRabbit (Phase 5.5) | `/tdd-implement` v2 / `/harness-merge-train` M2.2 が呼ぶ |
| `/coderabbit-review` | 本物 CodeRabbit 監視 (Phase 6) | `/tdd-implement` v2 / `/parallel-worktree` / `/harness-merge-train` M5 が呼ぶ |
| `/codex-team` | Codex セカンドオピニオン (Phase 7) | `/tdd-implement` v2 / `/harness-merge-train` M2.1 / M6 が呼ぶ |
| `/branch-merge` | 単一 feature → dev/main の linear merge | 本 dispatcher のスコープ外 (sibling、別 use case) |
| `/harness-plan` | 計画・Plans.md 管理 | `/harness-work` の前段で使う |
| `/harness-review` | 多角的レビュー (実装後の独立レビュー) | 実装後任意、`/harness-work` からは呼ばない |
| `/harness-release` | リリース / バージョンバンプ | 実装完了後任意 |
| `/session-handoff` | handoff init / update / archive / check | `/harness-work` Step 0a / Closing ritual / `/harness-merge-train` M9 / Loop exit が呼ぶ |

---

## 品質ゲート一覧 (全モード共通)

| Gate | 実行主体 | 失敗時挙動 | 省略可否 |
|---|---|---|---|
| Gate 1: Red テスト先行 | `/tdd-implement` v2 Phase 2 | 着手ブロック | 禁止 |
| Gate 2: Green + 全既存テスト通過 | `/tdd-implement` v2 Phase 3 | Phase 3 差し戻し | 禁止 |
| Gate 3: Codex 並列検証 | `harness:codex-sync` | Codex 未インストール時のみスキップ可 (明示記録) | 原則禁止 |
| Gate 4: Codex レビューループ | `harness:codex-sync` | critical/major が 0 になるまで反復 | 禁止 |
| Gate 5: 疑似 CodeRabbit | `/pseudo-coderabbit-loop` | actionable=0 まで反復 (max 5 回) | 禁止 |
| Gate 6: 本物 CodeRabbit | `/coderabbit-review` (coordinator) | APPROVED or unresolved=0 まで反復 | 禁止 |
| Gate 7: Codex セカンドオピニオン | `/codex-team adversarial` | critical 発見 → Gate 1 に差し戻し | 強く推奨 (プロジェクト設定で無効化可) |

Gate 1-5 は worktree / Agent 内で blocking 実行、Gate 6 は coordinator が非同期監視、Gate 7 は PR merge 前に 1 回 (`Agent` は公式 subagent spawn tool、旧称 `Task` は現行 catalog 未掲載)。

---

## Follow-up notes (Codex 調査で判明した未検証事項)

以下は公式ドキュメントで明示されていない / 実運用で検証が必要な事項。リグレッション発生時の原因特定用に記録:

1. **`allowed-tools: ["Skill"]` の動作**: Skill frontmatter に `Skill` ツールを指定できるか公式ドキュメント未記載。現状の `/harness-work` / `/tdd-implement` は `"Skill"` を `allowed-tools` に含めているが、実際にモデルが Skill ツールを呼べるかは最新 Claude Code 版で要検証。動作しない場合は Bash 経由 (`claude --skill ...`) or プロンプト指示のみで代替。

2. **`context: fork` frontmatter の適用**: `/tdd-implement` に `context: fork` を追加すると独立コンテキストで動作するはずだが、harness-work から起動された場合の Plans.md 更新責務の分担が未決定。現状は coordinator (harness-work) 側で Plans.md 更新する設計だが、fork 内で更新した場合の整合性は未検証。

3. **`disable-model-invocation: true` の挙動**: ユーザー明示呼出のみを許可する frontmatter フィールド。現状の `/harness-work` / `/tdd-implement` には設定していないが、循環呼出リスク軽減のために追加を検討 (ただし description で自動選択制御する方が柔軟)。

4. **`harness:worker` plugin-scoped agent 名の Agent 引数**: `Agent({subagent_type: "harness:worker"})` 形式が実際に動作するか要検証。現状の `/parallel-worktree` は `subagent_type: "harness:worker"` を指定しているが、plugin-scoped name 解決が最新 Claude Code で正しく動くか未確認 (公式 subagent spawn tool は `Agent`、旧称 `Task` は現行 catalog 未掲載)。

5. **SessionMode 拡張**: `core/src/types.ts` の `SessionMode` に `"tdd"` / `"parallel-worktree"` を追加するかは設計判断待ち。既存の `"work"` / `"breezing"` を継続利用で運用上問題ないなら変更不要。

6. **State store の並行書込競合**: 将来のバージョンで file locking (`proper-lockfile` 等) 導入を予定。現状は Plans.md coordinator 専任運用で回避済み。

これらの事項は Phase 2+ 以降で検証・修正する。現状の設計で動かない場合は **フォールバック戦略** (下記) で品質ゲートを維持する。

---

## フォールバック戦略 (品質ゲートを維持する)

品質ゲートを外す代わりに委譲方式を変更するフォールバック:

| 失敗シナリオ | フォールバック |
|---|---|
| `Skill({skill: "tdd-implement"})` が動作しない | harness-work が tdd-implement の内容をインライン展開してプロンプトに埋込 (品質ゲート節を必須埋込) |
| `harness:codex-sync` agent 起動失敗 | `Bash` で `codex exec ...` を直接呼ぶ (同じ品質確保) |
| `/pseudo-coderabbit-loop` Skill 呼出失敗 | `coderabbit-mimic` agent を直接 Agent tool で起動 |
| `/parallel-worktree` Skill 呼出失敗 | harness-work が直接 worktree 生成 + harness:worker を Agent ツール並列起動 (各 Agent で TDD 強制節埋込) |
| Codex CLI 未インストール | Codex Phase をスキップ、その旨を Plans.md / 完了報告に明示 |
| CodeRabbit 設定なし (`.coderabbit.yaml` なし) | Phase 5.5/6 をスキップ、その旨を明示。プロジェクト側で `.coderabbit.yaml` + GitHub App install を推奨 |

**原則**: フォールバック時も品質ゲート (Red テスト / Green / Codex レビュー) を外さない。Skill 呼出メカニズムが不安定でも TDD は死守。

---

## スキル更新履歴

- **v5 (2026-04-26)**: Step 2 モード判定に **`merge` mode 最優先評価** を追加し、複数 PR の squash merge orchestration を **`/harness-merge-train` (v5 で新設)** に委譲する経路を spec 化。`detect_merge_orchestration()` シグナル (PR 番号 ≥ 2 / handoff backlog merge keyword / `gh pr list` open PR ≥ 2 + 追加 guard / `--merge` flag) で auto-detect (Signal 3 は default opt-out、`work.allowMergeAutoSignal3: true` で opt-in)。`--merge` flag を `argument-hint` に追加。**Skill connectivity 原則** (user / agent から直接 Bash / gh CLI で多 PR orchestration は構造規律違反、skill 内部で gh/git を使うのは設計、skill bypass は consumer-side discipline ledger に append-only 自動追記) を frontmatter 直下に固定 box として宣言。Step 4 に **4.6 Merge mode** delegation section 追加 (PROFILE materialize 規約継承)。関連スキル table に `/harness-merge-train` / `/branch-merge` / `/session-handoff` を追加 (skill connectivity の網羅性確保)。**v4 互換性は破壊しない** (solo / parallel / breezing / sequential / dry-run / fix-bug / add-feature 経路は不変、merge mode は最優先評価で先取り)。
- **v4.2 (2026-04-22)**: project-specific pipeline 検証サブフローフラグ (ダブルダッシュ prefix 付き `test-pipeline`) を除去 (breaking change)。`harness-work.md` のフラグ定義 / mode table / pseudocode / 独立サブフローセクション / description frontmatter を合わせて 6+2 箇所削除、generality guard pattern B-2f で再導入を CI blocking。移行先: project-local skill (例: `.claude/skills/<project>-local-rules/references/pipeline-check.md`) 経由で受ける。歴史的記述 (v3/v2/v1 の `test-pipeline` 言及) は経緯保持のため残置。
- **v4.1 (2026-04-19 Codex 調査反映)**: Auto Mode Detection v2 (依存グラフ考慮、独立グループ数ベース)、`--affected` オプション追加 (Nx 流)、Phase fan-out パターン明示化、`harness.config.json` 拡張フィールド詳細化 (tddEnforce / worktree.forceDisableReasons / codeRabbit bucket size)、品質ゲート一覧、follow-up notes セクション、フォールバック戦略追加。
- **v4 (2026-04-19)**: 内部委譲化。`/tdd-implement` v2 / `/parallel-worktree` v1 への委譲レイヤーに刷新。品質ゲート常時強制。v3 以前で発覚した「worker 丸投げで品質ゲート省略」問題を構造解消 (詳細は CHANGELOG.md)。
- **v3** _(v3 で統合、v4.2 で除去)_: Auto Mode Detection (Solo/Parallel/Breezing) 導入、`--codex` オプション追加、サブフロー (fix-bug/add-feature/test-pipeline) 統合。
- **v2, v1** _(歴史的記録、v4.2 で除去)_: レガシー (`work` / `breezing` / `fix-bug` / `add-feature` / `test-pipeline` が別スキルだった時代)。
