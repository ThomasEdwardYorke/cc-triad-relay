---
name: parallel-worktree-v2
description: "**Model B** 並列 TDD 開発オーケストレータ (v2)。各 worktree で独立した top-level claude プロセスを tmux session 上に起動し、それぞれが内部で `/tdd-implement` Phase 1-7 を完全実行する。coordinator は worktree 生成 / tmux 管理 / 進捗 aggregation / `/harness-merge-train` (Phase 8) のみを担当する。Use when 3+ independent sub-tasks need true parallel TDD with full per-worktree skill access (Pseudo CR + Real CR + Codex Phase 7 each)。v1 (`parallel-worktree`、Model A) も並存 — 2-3 件以下や stable な subagent 範囲では v1 default。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput", "Monitor"]
argument-hint: "[spec|feature-branch|max-parallel|tmux-session|profile|attach|status|stop|dry-run|no-commit]"
---

# `/parallel-worktree-v2` — Model B 並列 TDD 開発オーケストレータ (v2)

## 並列実行モデルの説明 — Model B

**本スキルは Model B (worktree ごとに独立 `claude` プロセス) で動作する。**

```text
+-----------------------------------------------------------------+
| coordinator session (this skill, runs once)                     |
|  - tmux session controller (launch / status / attach / stop)    |
|  - progress aggregator (session-manager.ts dashboard)           |
|  - merge train orchestrator (Phase 8: /harness-merge-train)     |
+-------+----------------------+----------------------+-----------+
        |                      |                      |
        v                      v                      v
+---------------+      +---------------+      +---------------+
| tmux window 1 |      | tmux window 2 |      | tmux window N |
| claude -n A   |      | claude -n B   |      | claude -n N   |
| /tdd-implement|      | /tdd-implement|      | /tdd-implement|
|  Phase 1-7    |      |  Phase 1-7    |      |  Phase 1-7    |
+---------------+      +---------------+      +---------------+
        |                      |                      |
   worktree A             worktree B             worktree N
   (sibling repo + ~/.claude/ overlay shared automatically)
```

- **coordinator** は本スキルを起動した parent claude セッション。orchestrate のみ。
- **per-worktree claude** は **完全独立** な top-level claude プロセス。`Skill` / `Agent` tool フル access、自身で Codex 並列起動 / Real CR 監視 / `/codex-team` 実行が可能。
- 各 worktree は parent context を共有しない (1M context budget per worktree)。

### v1 (Model A) との対比

| layer            | v1 (Model A)                                        | v2 (Model B、本スキル)                                                                 |
|------------------|------------------------------------------------------|----------------------------------------------------------------------------------------|
| coordinator      | parent claude セッション                             | parent claude セッション (但し worker 走行中は orchestration のみ、Claude 推論ループ最小) |
| per-worktree     | `Agent`-tool subagent (`harness:worker`)             | **独立 top-level `claude -n <slug>` プロセス** (tmux window 内)                          |
| harness 継承     | parent context 共有                                  | 各 worktree が user-level `~/.claude/` overlay を独立に load                            |
| skill access     | 制限 (subagent 内では `Skill` 使用不可)               | full (skills / agents / MCP / hooks 全部使える)                                        |
| context budget   | parent と共有                                        | 各 worktree が **独立 1M context**                                                     |
| Phase 5.5/6/7    | coordinator が worker 完了後に逐次実行                | **各 worktree が自身で実行** (Pseudo CR / Real CR / Codex Phase 7)                     |
| Phase 8 (merge)  | coordinator (`/harness-merge-train`)                 | coordinator (`/harness-merge-train`、同左)                                             |
| 高並列耐性       | 3+ で context overflow / subagent OOM (issue #19077) | 各 worktree が自律 → **理論上数十並列まで scale**                                       |

**v1 を使うべきとき**: 2-3 件の小規模並列、各 sub-task が短時間 (~10 min)、subagent 構成で context が溢れない見込みがあるとき。
**v2 を使うべきとき**: 3+ 件並列、long-running TDD (各 sub-task ~30 min+)、Pseudo CR / Real CR / Codex Phase 7 を per-worktree で動かしたいとき、parent claude が他の作業を並行したいとき。

---

## 前提 primitive (Phase 2 Stage B/C/D)

v2 skill は以下の Stage B/C/D primitive に依存する:

| Stage | ファイル | 役割 |
|---|---|---|
| **Stage B** | `plugins/harness/scripts/parallel-sessions-template.sh` | tmux session launcher。`start N <slugs>` で N worktree + N tmux window + N 独立 claude を起動 |
| **Stage C** | `plugins/harness/core/src/session-manager.ts` | progress aggregator。各 window の git log + stream-json log を読んで dashboard 表示 |
| **Stage D** | `plugins/harness/commands/claude-oneshot.md` | `claude -p <instruction> --output-format stream-json` の wrapper skill。再現性の高い one-shot 実行に使用 |

これら 3 件が main に landing 済の前提で v2 skill が動作する (Stage A design doc と整合)。

---

## 基本原則

1. **TDD + Codex は各 worktree 内で完結**: per-worktree claude が `/tdd-implement` v2 を fully 実行 (Phase 1-7)。coordinator は orchestrate に専念。
2. **Phase 5.5 / 6 / 7 は各 worktree responsibility**: 疑似 CodeRabbit / 本物 CodeRabbit / Codex セカンドオピニオンは per-worktree、coordinator が後で呼び直さない。
3. **coordinator は薄い**: worktree 生成 / tmux session 管理 / dashboard 集約 / merge train 起動。worker 走行中は active reasoning loop を持たない。
4. **妥協禁止**: 「context 不足」「subagent 制限」を理由に Phase を skip しない (v2 はまさにそれを解消する設計)。
5. **汎用スキル**: 全プロジェクトで使える。プロジェクト固有 (`.coderabbit.yaml` / `CLAUDE.md`) は各 worktree が自動 inherit。
6. **Anthropic 公式準拠**:
   - `claude -n <name>` は **display name only** (interactive session の表示名、resume 機構ではない)
   - session resume は `claude -r <session-id>` または `--resume`
   - headless 取得は `claude -p '<prompt>' --output-format stream-json`
   - stream-json の終端は `type: "result"` + `subtype: "success"` (error subtype: `error_max_turns` / `error_max_budget_usd` / `error_during_execution` / `error_max_structured_output_retries`)

---

## 入力仕様

### Option A: `--spec=<json-file>` で指定

```json
{
  "feature_branch": "main",
  "base_dir": "/path/to/project",
  "worktree_parent_dir": "/path/to/project/..",
  "worktree_prefix": "myproject-wt-",
  "tmux_session_name": "harness-parallel",
  "claude_per_session_options": {
    "model": "claude-opus-4-7",
    "permission_mode": "acceptEdits",
    "output_format": "stream-json",
    "log_dir": "/tmp"
  },
  "sub_tasks": [
    {
      "slug": "frontend",
      "work_item_label": "frontend-work",
      "title": "frontend foundation scaffold",
      "description": "...",
      "acceptance_criteria": ["..."],
      "owned_files": ["src/frontend/**"],
      "forbidden_files": ["pyproject.toml", "src/backend/*"],
      "depends_on": [],
      "merge_priority": 4
    }
  ]
}
```

**v2 で新規 / 変更されたフィールド** (v1 spec との互換性のため):

- `tmux_session_name` (新規必須): `tmux new-session` で作成する session 名。同名 session が既存なら attach、なければ create。
- `claude_per_session_options` (新規必須): per-window の `claude` プロセス起動オプション。`output_format: "stream-json"` で stream-json log を `/tmp/claude-log-<slug>.jsonl` に書き出し、session-manager から読める形にする。
- `work_item_label` (v1 `task_id` を改名): 内部 tracker ID をそのまま使うのではなく、project-neutral な label に。consumer は spec build 時に自身の ID 体系を mapping する。

### Option B: positional arguments (簡易、`--spec` 省略時)

```text
/parallel-worktree-v2 <feature-branch> <slug1> <slug2> ... [--profile=<chill|assertive|strict>] [--max-parallel=N] [--dry-run] [--no-commit]
```

`--max-parallel=N` で同時稼働する tmux window 数を制御 (default = `sub_tasks.length`)。N が `sub_tasks.length` より小さい場合、coordinator は完了 window から順次新規 dispatch する semaphore 制御を行う。

### Subcommands (operator interaction)

```text
/parallel-worktree-v2 status                # 各 window の Phase / 最新 commit / status を表示
/parallel-worktree-v2 attach <slug>         # 指定 slug の tmux window に attach
/parallel-worktree-v2 stop [--rollback]     # 全 worktree session を停止 (rollback 時は worktree 削除も)
```

---

## Pre-flight (Phase 0)

着手前に必ず実行する 7 項目:

1. **`feature_branch` の存在 + clean 確認** (`git status`)
2. **重複 worktree / 同名 tmux session の検出** (`git worktree list` / `tmux list-sessions`)
3. **`owned_files` / `forbidden_files` の overlap 静的解析** (`detectOverlap()` — v1 と共有)
4. **依存関係 (`depends_on`) の topological sort 実行可能性確認**
5. **Codex CLI の可用性 + Anthropic auth 確認** (`codex --version`)
6. **Stage B/C/D primitive の存在確認** (`scripts/parallel-sessions-template.sh` / `session-manager.ts` / `claude-oneshot.md` 全在)
7. **Plans.md / handoff doc に新規 sub-tasks の担当表 row 追加** (Plans-mode のみ — handoff-mode は backlog 直接更新)

いずれかが fail なら `--dry-run` で先に検証 → 修正 → 本実行。

---

## Phase 1: tmux session 起動 + worktree 生成

```bash
# coordinator が呼出 (Stage B template script を経由)
bash plugins/harness/scripts/parallel-sessions-template.sh start \
     "${TMUX_SESSION_NAME}" \
     --feature-branch "${FEATURE_BRANCH}" \
     --slugs "${SLUG_LIST}" \
     --model "${MODEL}" \
     --permission-mode "${PERM}"
```

template script の役割:
- `tmux new-session -d -s "$TMUX_SESSION_NAME"` で detached session 作成
- 各 slug について `git worktree add ../<prefix><slug> -b feature/<feature>-<slug> <feature_branch>`
- 各 worktree について `tmux new-window -t "$session" -n "$slug" "cd <wt> && claude -n <slug> <model_flag> --permission-mode <perm>"`
- `claude -n <slug>` は **display name のみ** を `<slug>` に設定 (Anthropic CLI 仕様、session resume 機構ではない)
- 各 window で claude が立ち上がる (interactive prompt)

### tmux pane vs window

default は **window per worktree** (一画面一 worktree、`tmux select-window` で切替)。`--pane-layout=tiled` 指定時は単一 window 内に N pane を tiled split (operator が全 worktree を一覧する用途)。

---

## Phase 2: 各 claude session に作業 prompt を inject

```bash
# coordinator が各 window へ第一プロンプトを送信
for slug in "${SLUGS[@]}"; do
  prompt="/tdd-implement ${slug_to_task_id[$slug]} --profile=${PROFILE} ${NO_COMMIT}"
  tmux send-keys -t "${TMUX_SESSION_NAME}:${slug}" "${prompt}" Enter
done
```

`/tdd-implement` v2 が各 claude 内で起動し、内部で:

| Phase | 内容 |
|---|---|
| Phase 1 | 計画 + Plans.md 担当表更新 (Plans-mode) or handoff backlog 更新 (handoff-mode) |
| Phase 2 | TDD Red (失敗テスト先行) |
| Phase 3 | TDD Green (最小実装) |
| Phase 4 | Codex 並列検証 (`harness:codex-sync` を Agent tool で起動、各 worktree 内で並列) |
| Phase 5 | Refactor + Codex review loop |
| **Phase 5.5** | `/pseudo-coderabbit-loop --local --profile=${PROFILE}` で push 前 pre-review |
| **Phase 6** | push → `/coderabbit-review <pr>` で本物 CodeRabbit 監視 (Strong Clear 3 段判定) |
| **Phase 7** | `/codex-team` で Codex 敵対的セカンドオピニオン |

**鍵**: Phase 5.5 / 6 / 7 は **各 worktree 内** の claude が実行する。Model A では coordinator が全 worker 完了後に逐次実行する必要があったが、v2 では per-worktree で並列実行される (true parallelism)。

---

## Phase 3-7: 各 worktree が自律実行 (coordinator は monitor のみ)

coordinator は worker 走行中は **active reasoning loop を持たない**。代わりに:

```bash
# session-manager.ts dashboard を起動 (Stage C primitive)
node plugins/harness/core/src/session-manager.ts \
     --tmux-session "${TMUX_SESSION_NAME}" \
     --log-dir /tmp \
     --refresh-interval 30
```

dashboard 表示例:

```text
[harness-parallel] tmux session — 4 windows, 4 sub-tasks

  | slug      | branch              | phase | last commit          | status                          |
  |-----------|---------------------|-------|----------------------|----------------------------------|
  | frontend  | feature/main-fe     | 5.5   | a1b2c3d 2 min ago    | actionable=0, Pseudo CR clean    |
  | backend   | feature/main-be     | 5     | e4f5g6h 6 min ago    | running Codex review (Phase 5)   |
  | shared    | feature/main-shared | 7     | i7j8k9l 12 min ago   | Codex Phase 7 SHIP               |
  | docs      | feature/main-docs   | 8     | m0n1o2p 18 min ago   | merged ✓                         |
```

session-manager は以下の signal を per-worktree で集約:
- **git commit log** (どの slug が何時にどの commit を landing したか)
- **stream-json log** (`/tmp/claude-log-<slug>.jsonl` を tail、`tool_name == "TaskUpdate"` の Phase marker を抽出)
- **idle detection** (last-event-timestamp > 10 min で WARN、> 30 min で FAIL に escalate)

---

## Phase 8: coordinator が merge train を起動

全 worktree が Phase 7 (SHIP) に到達したら coordinator が `/harness-merge-train` を実行:

```text
/harness-merge-train --tmux-session=<TMUX_SESSION_NAME> --priority-mode=topological
```

merge train の責務:
1. 各 PR の Real CR Strong Clear 確認 (APPROVED state OR unresolved=0 + rate-limited marker 不在)
2. Codex Phase 7 SHIP verdict 確認
3. 依存関係 (`depends_on`) と `merge_priority` で squash 順序を決定
4. 各 PR を sequential squash merge (rebase 衝突は coordinator が解消)
5. 全 merge 完了後、`tmux kill-session -t "${TMUX_SESSION_NAME}"` + worktree 削除 + branch 削除

---

## Failure recovery

各 worktree の claude session crash / hung / 異常終了に対する recovery:

| 症状 | 検出 | 対応 |
|---|---|---|
| stream-json log 10 min 無更新 | session-manager WARN | `/parallel-worktree-v2 attach <slug>` で operator が状況確認 |
| 30 min 無更新 | session-manager FAIL | operator が `tmux kill-window -t <session>:<slug>` → 当該 worktree のみ手動再開 (`claude -r <session-id>`) |
| `result.subtype == "error_max_turns"` | stream-json で検出 | budget 増 + retry。task spec の AC を細分化検討 |
| `result.subtype == "error_during_execution"` | stream-json で検出 | crash log 確認、bug fix 後 retry |
| tmux session 全消失 | OS reboot 等 | `--rollback` で worktree も削除、最初からやり直す or 各 branch から個別再開 |

**自動 restart は無効** (default)。Anthropic responsible-AI guidance に倣い、autonomous restart は operator confirmation 必須。

---

## Migration from v1

| Step | timing | action |
|---|---|---|
| 1 | v2 ship 直後 (Stage E land) | v1 (`/parallel-worktree`) は default のまま。v2 は opt-in |
| 2 | 実プロジェクト pilot (Phase 3 P3.1) | 1 つの multi-task batch を v2 で実施、A/B 比較 |
| 3 | A/B data 確認後 | v2 を recommend default に昇格、v1 に deprecation 警告追記 (Stage F で実装済) |
| 4 | 半年後 | v2 promoted to default、v1 は legacy として残存 |
| 5 | 1 年後 | v1 完全 removal は別 RFC で議論 |

**v1 / v2 はずっと並存可能**。consumer project が `claude_per_session_options` field を spec.json に含むか否かで自動 routing する fallback も提供 (`/parallel-worktree` v1 が detect → v2 に forward)。

---

## Generality compliance (R1-R3 確認)

- **R1 (PoC 順序)**: 本 skill は Stage A design doc + Stage B/C/D primitive (test bed validated) を統合した shipped spec。新規 invariant は無く、既存 primitive の orchestrate のみ。
- **R2 (内部 tracker leak 禁止)**: 本 spec は project-neutral な terminology (`feature_branch` / `slug` / `work_item_label`) のみ使用。consumer project の ID は spec.json build 時に mapping する。
- **R3 (例示値 generic)**: 例示の `feature/main-fe` / `myproject-wt-` 等は generic placeholder。

---

## References

- v1 spec: `commands/parallel-worktree.md` (Model A、subagent ベース、引き続き提供)
- Stage A design doc: `docs/parallel-worktree-v2-design.md` (`Why v2` / アーキテクチャ詳細)
- Stage B template: `scripts/parallel-sessions-template.sh`
- Stage C aggregator: `core/src/session-manager.ts`
- Stage D primitive: `commands/claude-oneshot.md`
- ROADMAP: `docs/maintainer/ROADMAP-model-b.md` Phase 2/3
- Anthropic CLI reference: <https://code.claude.com/docs/en/cli-reference> (`-n` display name / `-r` --resume / `-p` headless / `--output-format stream-json` 仕様)
- Anthropic skills system: <https://code.claude.com/docs/en/skills> (frontmatter / SKILL.md spec)
- Anthropic worktree issue: <https://github.com/anthropics/claude-code/issues/28041> (`.claude/` 非継承)
- Anthropic nested-subagent OOM: <https://github.com/anthropics/claude-code/issues/19077> (Model A の構造的天井)
- Related external work: [workmux](https://github.com/raine/workmux), [Codeman](https://github.com/Ark0N/Codeman)
