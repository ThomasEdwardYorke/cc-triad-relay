# Claude Code Harness — Install bootstrap template

このディレクトリは harness plugin が新規プロジェクトに配布する **install
bootstrap template** です。Plugin install 後、`/harness-setup init` (または
`harness init` CLI) を実行すると以下が自動配布されます。

---

## 自動で用意されるもの (`harness init` 実行時)

| ファイル | 用途 | source |
|---|---|---|
| `harness.config.json` | Plugin 設定 (protected dirs / Codex / TDD enforce 等) | `template/.claude/harness.config.json.tmpl` |
| `CLAUDE.md` | チーム共有 instructions (`{{PROJECT_NAME}}` 置換) | `template/.claude/CLAUDE.md.tmpl` |
| `Plans.md` | タスク管理 doc 雛形 | `template/Plans.md.tmpl` |
| `.coderabbit.yaml` | CodeRabbit 設定 (APPROVED auto-fire 有効化済) | `template/.coderabbit.yaml.tmpl` |
| `.claude/settings.local.json` | permissions 雛形 | `template/.claude/settings.local.json.tmpl` |
| `.claude/rules/*.md` | auto-load される運用 rules (TDD / branching / pr format / language / harness workflow / prompt injection guard) | `template/.claude/rules/` |
| `.github/workflows/harness-check.yml` | CI workflow (`harness check` 自動実行) | `template/.github/workflows/harness-check.yml.tmpl` |
| `.gitignore` | runtime state / secrets / editor 除外 | `template/.gitignore` |

**idempotent**: 既存 file は touch しない (二重 `init` は no-op)。

---

## ユーザーがやることチェックリスト (install → 完全動作)

新規プロジェクトを 0 から CodeRabbit + Codex + TDD + 完全品質ゲートで
動作させるまでの **完全 step**:

### 1. Plugin install (claude code が必要)

```bash
claude plugin marketplace add ThomasEdwardYorke/cc-triad-relay
claude plugin install harness@cc-triad-relay --scope project

# 推奨: Codex companion も install (codex-sync / coderabbit-mimic で必要)
claude plugin install codex@openai-codex --scope project
```

### 2. Bootstrap files を生成

```bash
cd path/to/your-project
# claude code セッションから:
/harness-setup init
# または CLI から:
harness init
```

→ 上記表の全 file が配布される。

### 3. 配布された file を編集

| ファイル | 編集ポイント |
|---|---|
| `harness.config.json` | `projectName` / `language` / `protectedDirectories` / `testCommand` / `worktree.defaultBaseBranch` 等を環境に合わせて調整 |
| `CLAUDE.md` | プロジェクト概要・スタック・設計方針を記述 (`{{PROJECT_DESCRIPTION}}` placeholder を実内容で置換) |
| `.coderabbit.yaml` | `language` (`en-US` / `ja-JP`)、`tone_instructions`、`path_instructions` をプロジェクトに合わせる。**既存の `request_changes_workflow: true` は APPROVED 自動発火に必要なので残す** |
| `Plans.md` | 初期タスクを追加 |
| (任意) 個人運用 instructions が必要なら `.claude/` 配下に独自 file を追加 (`.gitignore` 済) |  |

### 4. External dependencies を install

`harness check` で `WARN: not on PATH` が出ない状態にする:

```bash
# GitHub CLI (PR / review ops に必要)
brew install gh           # macOS
# または: https://cli.github.com/

# CodeRabbit CLI (/pseudo-coderabbit-loop の real-CR 経路で使う)
brew install coderabbit/tap/coderabbit

# Codex CLI は plugin install で自動入手 (Step 1 の codex@openai-codex)
```

### 5. CodeRabbit App を GitHub repo に install

CodeRabbit は plugin ではなく **GitHub App**。dashboard 経由 install:

1. https://app.coderabbit.ai/ にログイン
2. install 対象 repo を選択 (admin 権限が必要)
3. `.coderabbit.yaml` は **default branch (`main`) に push されて初めて effective**
4. 必要なら OSS plan 申請 (PR review 2/h + CLI review 2/h、Pro 5/h と独立 bucket)

### 6. CI で `harness check` を有効化

```bash
git add .github/workflows/harness-check.yml
git commit -m "ci: add harness check workflow"
git push
```

→ `harness` CLI が runner にインストールされている場合、PR ごとに plugin
integrity が GitHub Actions で確認される。**default の workflow は `harness`
不在時に warning を出して成功終了 (best-effort)** するため、実 merge gate
にしたい場合は workflow 内コメントアウトされている `Install harness plugin`
step を有効化するか、runner に CLI を pre-install してください。

### 7. Integrity 検証

```bash
harness check
```

期待出力:
```text
Plugin integrity:
  core build               OK
  manifest                 OK
  ...
Project state (recommendations, non-blocking):
  .coderabbit.yaml         OK
  gh                       OK
  codex                    OK
  coderabbit               OK
```

WARN が残れば、対応する step (3-5) を見直し。

---

## standalone (plugin 不使用) で個別 copy する場合

```text
template/.claude/CLAUDE.md.tmpl              → <your-project>/CLAUDE.md
template/.claude/harness.config.json.tmpl    → <your-project>/harness.config.json
template/.claude/settings.local.json.tmpl    → <your-project>/.claude/settings.local.json
template/.claude/rules/                      → <your-project>/.claude/rules/
template/.coderabbit.yaml.tmpl               → <your-project>/.coderabbit.yaml
template/Plans.md.tmpl                       → <your-project>/Plans.md
template/.github/workflows/harness-check.yml.tmpl → <your-project>/.github/workflows/harness-check.yml
template/.gitignore                          → merge into <your-project>/.gitignore
```

placeholder (`{{PROJECT_NAME}}` / `{{PROJECT_DESCRIPTION}}` / `{{HARNESS_VERSION}}`)
は手動置換が必要。

**推奨は plugin install 経由** (Step 1-2)。手動 copy は CI 環境など限定用途のみ。

---

## 関連 docs

- [`../docs/en/installation.md`](../docs/en/installation.md) — 詳細 install ガイド
- harness-setup skill: `plugins/harness/commands/harness-setup.md`
- [`../docs/maintainer/test-bed-usage.md`](../docs/maintainer/test-bed-usage.md) — plugin 改修者向け
