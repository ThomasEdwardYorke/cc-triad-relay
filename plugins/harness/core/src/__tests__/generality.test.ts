/* generality-exemption: B-1,B-2a,B-2b,B-2c,B-2d,B-2e,B-2f,B-3a,B-3b,B-3c,B-3d,B-3e,B-3f,B-3g,B-3h,B-4a,B-4b,B-5,B-6,B-7,B-8,B-9,B-10 | HARNESS-generality-self | 2099-12-31 | detector harness itself must reference patterns it blocks (self-reference unavoidable, until v1.0 redesign) */
/**
 * core/src/__tests__/generality.test.ts
 *
 * 目的: harness plugin を汎用公開 plugin として維持するための **project-local leak 防止テスト**。
 *
 * 背景: parts-management (test bed) との並行開発で、shipped spec に project-specific な業務用語 /
 * ブランチ名 / 内部タスクトラッカー ID / 特定 web stack 前提が混入する事象が発生した
 * (2026-04-22 監査で 119 件検出)。本テストは以下 5 系列の leak を CI で blocking:
 *
 *   - 系列1: specific branch names (feature/new-partslist 等)
 *   - 系列2: 前身プロジェクト業務用語 (upper_script / create_script_from_* / protected-data/ 等)
 *   - 系列3: 内部タスクトラッカー ID (Phase N 申送 / Round N / A-6 r\d+ 等)
 *   - 系列4: project-local ファイル必須参照 (CLAUDE.local.md / .docs/next-session-prompt.md)
 *   - 系列5: 特定 Python web stack の必須化 (checklist 形式で psycopg/defusedxml/WeasyPrint 等)
 *
 * 対象 scope:
 *   - BLOCKLIST_TARGETS (厳格禁止): plugins/harness/agents/*.md, commands/*.md, core/src/hooks/*.ts
 *   - WARN_TARGETS (soft): core/src/__tests__/*.ts (テスト describe 文に混入しやすいため)
 *   - ALLOWLIST (対象外): docs/maintainer/**, CHANGELOG.md, .github/**, node_modules/**, dist/**
 *
 * 例外許容 (exemption) — unified exemption grammar (pipe-separated, 4 required fields):
 *   Format: `generality-exemption: <pattern-ids> | <issue-key> | <expiry> | <reason>`
 *     - pattern-ids: B-\d+[a-z]? CSV list (`all` prohibited)
 *     - issue-key:   [A-Z][A-Z0-9_]*-[A-Za-z0-9_-]+ (e.g. HARNESS-42, HARNESS-generality-self, PARTS-12)
 *     - expiry:      vX.Y.Z (semver) | YYYY-MM-DD (ISO date) | YYYY-Qn (quarter)
 *     - reason:      free text
 *   Placement:
 *     - File-head Markdown: <!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->
 *     - File-head TS:       /* generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale *\/
 *     - Line-level (TS):    // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture
 *     - Line-level (MD):    <!-- generality-exemption: B-1 -->  (short form: pattern-ids のみ許容)
 *   Legacy forms (deprecated & rejected):
 *     - em dash + comma separators (`B-1 — HARNESS-42, v0.5.0, reason`) → throws
 *     - `generality-ok` keyword at line level                          → no longer recognized
 *
 * 公式仕様参照:
 *   - https://code.claude.com/docs/en/plugins : plugin は shared/reusable、project-specific は .claude/ 側
 *   - https://code.claude.com/docs/en/plugin-marketplaces : 配布物の品質維持
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");

// ---------------------------------------------------------------------------
// Scope 定義
// ---------------------------------------------------------------------------

interface ScopeTarget {
  dir: string; // PLUGIN_ROOT からの相対
  exts: string[];
  recursive: boolean;
}

const BLOCKLIST_TARGETS: ScopeTarget[] = [
  { dir: "agents", exts: [".md"], recursive: false },
  { dir: "commands", exts: [".md"], recursive: false },
  { dir: "core/src/hooks", exts: [".ts"], recursive: false },
  // Codex 敵対的レビュー [C-1] 対応: ガードレール範囲を public docs / schema / 非 test 実装へ拡張
  { dir: "schemas", exts: [".json"], recursive: false },
  // core/src 全域を再帰走査 (ただし __tests__ は WARN_TARGETS で別扱い、後段で filter)
  { dir: "core/src", exts: [".ts"], recursive: true },
];

// テスト describe 文に leak が紛れるリスクを別枠で検出する。
const WARN_TARGETS: ScopeTarget[] = [
  { dir: "core/src/__tests__", exts: [".ts"], recursive: false },
];

// ---------------------------------------------------------------------------
// Blocklist パターン定義
// ---------------------------------------------------------------------------

interface BlockPattern {
  id: string;
  category:
    | "branch"
    | "legacy-api"
    | "tracker-id"
    | "project-file"
    | "web-stack"
    | "model-hardcode";
  pattern: RegExp;
  message: string;
  // テストファイルでも禁止か (false にすると test では warn のみ)
  appliesToTests: boolean;
  /**
   * Files matching this regex (relative to REPO_ROOT) are not scanned for
   * this pattern. Use when the pattern's semantic intent is in tension
   * with a declarative source-of-truth file that must carry the very
   * string the pattern rejects — e.g. `schemas/*.json` contains the
   * configured default model by design, so the `model-hardcode` pattern
   * skips it. Prefer file-head `generality-exemption` comments for code
   * files (those document the rationale inline).
   */
  skipFiles?: RegExp;
}

const BLOCK_PATTERNS: BlockPattern[] = [
  // ─────────────── 系列1: 特定ブランチ名 ───────────────
  {
    id: "B-1",
    category: "branch",
    pattern: /feature\/new-partslist/g,
    message:
      "parts-management の実ブランチ名 `feature/new-partslist` が shipped spec に含まれています。" +
      "例示は generic 値 (`feature/example-feature` / `feature/my-feature` / `main`) に置換してください。" +
      "参照: CONTRIBUTING.md Section 2 (Example Values 規約)",
    appliesToTests: true,
  },

  // ─────────────── 系列2: 前身プロジェクト業務用語 ───────────────
  {
    id: "B-2a",
    category: "legacy-api",
    pattern: /\bupper_script\b/g,
    message:
      "前身プロジェクト (script_generate) の業務 API `upper_script` が含まれています。" +
      "shipped spec に業務 API 名を含めず、project-local skill (CLAUDE.md / AGENTS.md) 参照方式にしてください。",
    appliesToTests: true,
  },
  {
    id: "B-2b",
    category: "legacy-api",
    pattern: /\bcreate_script_from_(url|sentence)\b/g,
    message:
      "前身プロジェクトの業務 API `create_script_from_url` / `create_script_from_sentence` が含まれています。" +
      "汎用 plugin では `public API` / `existing public function signatures` のような抽象表現を使ってください。",
    appliesToTests: true,
  },
  {
    id: "B-2c",
    category: "legacy-api",
    pattern: /protected-data\//g,
    message:
      "前身プロジェクトのディレクトリ `protected-data/` が含まれています。" +
      "project-specific path は harness.config.json で受けるか、project-local skill に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-2d",
    category: "legacy-api",
    pattern: /全9ジャンル/g,
    message:
      "前身プロジェクトの業務用語 `全9ジャンル` が含まれています。shipped spec から除去してください。",
    appliesToTests: true,
  },
  {
    id: "B-2e",
    category: "legacy-api",
    pattern: /\bscript_generate\b/g,
    message:
      "前身プロジェクト名 `script_generate` が shipped spec に含まれています。" +
      "case study は docs/maintainer/ に移管してください。",
    appliesToTests: true,
  },
  {
    // Phase λ 対応: 前身プロジェクト固有の pipeline 検証サブフローを除去。
    // `--test-pipeline` は business-specific flag (前身 project の CSV schema 検証 +
    // `scripts/check-pipeline.sh` を前提) で、汎用 plugin から除去する。project-local
    // な pipeline 検証は `.claude/skills/<project-name>-local-rules/references/pipeline-check.md`
    // 経由で実施する (test-bed 側は unified exemption grammar で移管済み)。
    //
    // Codex [A-N-1] 対応: 旧 regex `/--test-pipeline\b/` は `\b` が `\w\W` 境界で成立するため
    // `--test-pipeline-foo` にも false positive でヒットした。`(?![\w-])` で
    // 後続が word char / hyphen で **ない** 場合のみ match (suffix 境界のみ厳格化)。
    //
    // Codex 最終 review (m-2) 対応: prefix 側には制約がないため `----test-pipeline` や
    // `foo--test-pipeline` にも match する。本ファイル自身がこれらの例示を含むが、
    // ファイル冒頭の `generality-exemption: ...,B-2f,...` (HARNESS-generality-self) で
    // 自己 hit が無害化されている。case-sensitive (`--Test-Pipeline` は hit しない)。
    // 将来 case-insensitive 化 or prefix 境界強化が必要なら追加検討。
    id: "B-2f",
    category: "legacy-api",
    pattern: /--test-pipeline(?![\w-])/g,
    message:
      "前身プロジェクトの pipeline 検証サブフロー `--test-pipeline` が shipped spec に含まれています。" +
      "汎用 plugin から除去し、project-local skill (例: `.claude/skills/<project>-local-rules/references/pipeline-check.md`) " +
      "経由で受ける設計にしてください。" +
      "参照: docs/maintainer/leak-audit-2026-04-22.md の Phase λ 項目 (`--test-pipeline` DELETE 決定)。",
    appliesToTests: true,
  },

  // ─────────────── 系列3: 内部タスクトラッカー ID (M-4 拡張: 広い regex) ───────────────
  {
    id: "B-3a",
    category: "tracker-id",
    pattern:
      /(?:Phase\s*\d+[^.\n]{0,40}?申送|Phase\s*\d+\s*Codex[^.\n]{0,40}?申送|申送\s*[A-Z]-\d+|申送\s*M-\d+)/g,
    message:
      "内部タスクトラッカー ID (`Phase N 申送` / `Phase N Codex レビュー申送 C-N` / `申送 M-NN`) が含まれています。" +
      "shipped spec には書かず、CHANGELOG.md / commit message / docs/maintainer/ に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3b",
    category: "tracker-id",
    pattern: /\bRound\s*\d+\b/g,
    message:
      "内部開発ラウンド表記 (`Round N`) が含まれています。maintainer 内部用語です。" +
      "docs/maintainer/session-notes/ に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3c",
    category: "tracker-id",
    pattern: /\b[Aa]-\d+\s*(?:r\d+|round\s*\d+)(?:\s*[A-Z][a-z]+-\d+)?/g,
    message:
      "内部 Codex レビューラウンド ID (`A-N rM` / `A-N round M Major-L` 等) が含まれています。" +
      "maintainer 内部ログの ID を shipped spec に残さないでください。",
    appliesToTests: true,
  },
  {
    id: "B-3d",
    category: "tracker-id",
    pattern: /\b(?:Major|Minor|Trivial|Critical)-\d+\b/g,
    message:
      "内部 Codex レビュー severity ID (`Major-N` / `Minor-N` 等) が tracker label として含まれています。" +
      "shipped spec では description として書くか CHANGELOG.md に移管してください。",
    appliesToTests: true,
  },
  {
    id: "B-3e",
    category: "tracker-id",
    // Codex [M-4A] 指摘: bare `(C-N)` / `(M-N)` / `(m-N)` が content-integrity.test.ts の
    // describe titles などに残存していた。短すぎる一般語を誤検出しないよう、括弧で囲まれた
    // tracker label 形式に絞る: `(C-1)` / `(M-3)` / `(m-2)` / `(C-12 optional description)` 等
    pattern: /\((?:[CM]|m)-\d+(?:\s+[^)]*)?\)/g,
    message:
      "括弧形式の内部 tracker ID (`(C-N)` / `(M-N)` / `(m-N)`) が含まれています。" +
      "公式に昇格した issue key (例: `HARNESS-42`) に置換するか、" +
      "CHANGELOG.md / docs/maintainer/tracker-migration.md に移管してください。",
    appliesToTests: true,
  },
  {
    // Pseudo CodeRabbit pre-review の outside-diff 指摘で追加 + 後続 review feedback
    // で lookbehind 強化。Session 世代 ID `gen-N` は consumer-side handoff archive
    // (`session-<YYYY-MM-DD>-genNN-*.md`) で使われる project-local 用語であり、shipped
    // spec (plugins/harness/**) には混入禁止。
    //
    // Pattern 設計: `(?<![\w-])gen-\d+\b`
    //   - `(?<![\w-])` lookbehind: 直前が word char または `-` ではない (= 単語境界 +
    //     ハイフン区切りコンパウンド語境界)。これにより:
    //       - `general-13` no match (`gen` 後が `-` でない)
    //       - `9th-gen-13` no match (compound prefix、`gen` 直前が `-`)
    //       - `next-gen-4` no match (同上)
    //       - `gen-13` (単独/文頭/whitespace 後) match
    //   - `\b` 末尾: `gen-13a` は `\d+` の `13` 後に word char `a` → no match
    //     (`gen-1.3` は `gen-1` で stop、誤検出しない)
    //   - filename 内 `genN` (hyphen なし) は元々対象外
    id: "B-3f",
    category: "tracker-id",
    pattern: /(?<![\w-])gen-\d+\b/g,
    message:
      "内部 session 世代 ID (`gen-N`) が含まれています。consumer-side handoff の運用 ID で、" +
      "shipped spec には残さないでください。CHANGELOG.md / docs/maintainer/session-notes/ / " +
      "commit message に移管してください。",
    appliesToTests: true,
  },
  // B-3g: project-specific flag naming guard (Codex pre-flight Track A finding 由来)
  // 過去の meta-session で「`/harness-work --maintainer-mode` 拡張」のような
  // project-specific flag 提案が backlog 入りしたが、これは R2 (内部識別子 leak)
  // リスクが高い。`--source plans|roadmap` のような generic flag、もしくは既存
  // `taskTrackerMode = "handoff"` config field の活用に倒すべし (forcing function)。
  // 対象 flag 名: `--maintainer-mode` / `--model-b-mode` / `--parts-management-mode`
  // / `--script-generate-mode` / `--new-partslist-mode` 等の project-specific 形。
  // generic flag (`--source` / `--mode` / `--target` 等) と config field
  // (`taskTrackerMode` 等) は対象外。
  {
    id: "B-3g",
    category: "tracker-id",
    pattern:
      /--(?:maintainer-mode|model-b-mode|parts-management-mode|script-generate-mode|new-partslist-mode)\b/g,
    message:
      "project-specific flag naming (例: `--maintainer-mode` / `--model-b-mode`) が含まれています。" +
      "shipped spec では既存 `work.taskTrackerMode = \"handoff\"` config field の活用、" +
      "または generic flag (`--source plans|roadmap` 等) で受けるべきです。" +
      "本 pattern は将来の leak 予防 (B-3 系 tracker-id forcing function)。",
    appliesToTests: true,
  },
  // B-3h: 内部 backlog tracker ID `D-<digits>` (e.g. `D-74`, `D-150`, `D-165`) を
  // shipped spec で blocking する forcing function。test-bed の handoff backlog
  // (`.docs/handoff/<project>-backlog.md`) では `id: D-74` のような numeric な
  // 内部 tracker ID が legitimate に運用されているが、それを `commands/*.md` /
  // `agents/*.md` 等 shipped surface に転載すると R2 (内部識別子 leak) になる。
  //
  // 対象は **数字のみ** の suffix (`D-74` / `D-150` / `D-165`) に絞り、descriptive
  // suffix (`D-handoff-check-lightweight` / `D-harness-work-parallel-mode-v2`) は
  // negative cases として残す — descriptive ID は意味が文脈に近く leak リスクが
  // 低い。numeric ID は内部 tracker としてのみ意味を持つので、shipped spec から
  // 除外しても情報損失なし (代わりに `spec gap` / `feature flag X` 等の意味語に
  // 置換すべし)。
  //
  // 左境界の厳格化 (Codex Phase 7 minor 対応): 旧 regex `/\bD-\d+\b/g` は
  // `\b` が word/non-word 境界で成立するため `25-D-37` のような hyphen-compound
  // や `漢字D-37` のような CJK-adjacent でも誤 match した。`(?<![\w-])` で
  // 左側が word char / hyphen の場合を除外し、左境界を「文頭 or 純粋空白 /
  // 純粋句読点」に限定する (B-3f の `gen-N` pattern と同じ lookbehind 設計)。
  //
  // shipped spec で過去の関連 entry を参照したい場合は `git log` / CHANGELOG.md /
  // `docs/maintainer/` に移管する。
  {
    id: "B-3h",
    category: "tracker-id",
    pattern: /(?<![\w-])D-\d+\b/g,
    message:
      "内部 backlog tracker ID (`D-<digits>` 形式、例: `D-74` / `D-150`) が含まれています。" +
      "shipped spec から除外し、CHANGELOG.md / `docs/maintainer/` / commit message に移管してください。" +
      "意味のある descriptive suffix (例: `D-handoff-check-lightweight`) は対象外で、" +
      "numeric tracker ID のみが leak として扱われます。",
    appliesToTests: true,
  },

  // ─────────────── 系列4: project-local ファイル必須参照 ───────────────
  // 注意: optional / 条件付き参照 ("if exists", "存在すれば") は許容する。
  {
    id: "B-4a",
    category: "project-file",
    pattern: /CLAUDE\.local\.md/g,
    message:
      "parts-management 固有の個人設定ファイル `CLAUDE.local.md` が shipped spec に含まれています。" +
      "plugin は project-local ファイル名を hardcode しないでください。必要なら harness.config.json で受けます。",
    appliesToTests: true,
  },
  {
    id: "B-4b",
    category: "project-file",
    pattern: /next-session-prompt\.md/g,
    message:
      "parts-management 固有の運用ファイル `next-session-prompt.md` が含まれています。" +
      "handoff file の path は `work.handoffFiles` config で受ける設計にしてください。",
    appliesToTests: true,
  },

  // ─────────────── 系列5: 特定 Python web stack の必須化 ───────────────
  // checklist 形式 ("- [ ] ... psycopg ...") で plugin の **必須** チェックとして書かれている場合のみ検出。
  // 単なる例示 ("e.g. psycopg") は warning のみで OK (別枠で後続追加予定)。
  {
    id: "B-5",
    category: "web-stack",
    pattern:
      /-\s*\[\s*\]\s*[^\n]*(?:psycopg|defusedxml|WeasyPrint|openpyxl|y\.?js\s|Tabulator)/gi,
    message:
      "特定 Python/JS web stack (psycopg / defusedxml / WeasyPrint / openpyxl / Y.js / Tabulator) が" +
      "plugin の **必須チェック項目** として固定されています。" +
      "抽象化 (`ORM parameter binding 使用`) + project-local `security.projectChecklistPath` 経由にしてください。",
    appliesToTests: false,
  },

  // ─────────────── 系列6: Plans.md ファイル名 hardcode (Codex [C-1]) ───────────────
  // core hooks で `"Plans.md"` を hardcoded path として使うと、PLAN_FILE / plansFile 設定を無視する。
  // 純粋な言及 (`Plans.md 担当表` 等) はOKで、`resolve(projectRoot, "Plans.md")` のような実装コードが NG。
  {
    id: "B-6",
    category: "project-file",
    pattern: /resolve\([^,)]+,\s*["']Plans\.md["']\)|readFileSync\([^,)]+["']Plans\.md["']/g,
    message:
      "Plans.md のファイル名が core 実装に hardcode されています。" +
      "`work.plansFile` 設定 (schema 定義済) を読んで fallback するようにしてください。",
    appliesToTests: false,
  },

  // ─────────────── 系列7: 日本語 UI keyword hardcode in core hooks (Codex [C-3]) ───────────────
  // core/src/hooks/*.ts で `担当表` 等を実行時分岐の literal として使うと、i18n が不可能。
  {
    id: "B-7",
    category: "project-file",
    // TS ファイル内の string literal として日本語 UI keyword を hardcoded
    // (description / comment は別、`.includes("担当表")` のような実装コードのみ)
    pattern:
      /\.(?:includes|startsWith|endsWith|match|test|search)\(\s*["'](?:担当表|未着手|進行中|完了|計画|設計|実装)["']\)/g,
    message:
      "日本語 UI キーワードが core 実装の runtime 分岐に hardcode されています。" +
      "`work.assignmentSectionMarkers` / `work.statusKeywords` config 経由で受ける設計にしてください。",
    appliesToTests: false,
  },

  // ─────────────── 系列8: 絶対パス hardcode in shipped spec (Codex [C-1]) ───────────────
  {
    id: "B-8",
    category: "project-file",
    // 代表的な開発者固有パス: /Users/<name>/, /home/<name>/, C:\Users\<name>\
    pattern: /\/Users\/[a-z][a-z0-9_-]+\/|\/home\/[a-z][a-z0-9_-]+\/|C:\\Users\\[A-Za-z]/g,
    message:
      "個人固有の絶対パス (`/Users/<name>/...` 等) が shipped spec に含まれています。" +
      "`/path/to/project` のような placeholder に置換してください。",
    appliesToTests: true,
  },

  // ─────────────── 系列9: Python stack 実行例の universal default 化 (Codex [M-3]) ───────────────
  // 「Python example:」のようなラベルなしで Python コマンドを plugin-wide default として書くのは NG。
  {
    id: "B-9",
    category: "web-stack",
    // `PYTHONPATH=. pytest` / `source .venv/bin/activate` / `python3 -m pip list --outdated` 等
    pattern:
      /(?:source\s+\.venv\/bin\/activate|PYTHONPATH=[.\w\/]+\s+pytest|pip install --upgrade|python3?\s+-m\s+pip)/g,
    message:
      "Python 固有の実行コマンドが universal default として書かれています。" +
      "`Python example:` などのラベルで stack-specific と明示するか、`work.testCommand` config 経由にしてください。",
    appliesToTests: false,
  },

  // 系列10 (shipped spec 日本語混入) は現時点では policy-based 運用 (CONTRIBUTING §1.2 + 段階移行 plan)。
  // 実装は `docs/maintainer/english-migration.md` で roadmap 化 → 次セッション以降で CI 強制化予定。
  // (旧 "B-10 (日本語混入)" 割当は中止、現在の B-10 は model-hardcode に再割当済。)

  // ─────────────── 系列11: GPT model slug hardcode (v0.4.0 model registry) ───────────────
  // Harness-dispatched Codex invocations must resolve the model slug through the
  // `harness model resolve <agent>` CLI (see `plugins/harness/core/src/models/resolver.ts`)
  // so every project can pin / swap the default centrally. Literal `gpt-X.Y` /
  // `gpt-X.Y-codex` references in shipped spec defeat that contract.
  // Exempt surfaces: (a) schema.json (declarative default is required), (b) the
  // resolver source + its tests + config.ts via file-head exemption.
  {
    id: "B-10",
    category: "model-hardcode",
    // Matches OpenAI model slugs the Codex runtime emits (`gpt-5.5`, `gpt-5.4`,
    // `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`). Anchored on the `gpt-`
    // prefix + a `\d+\.\d+` minor number to avoid false-positive with other
    // strings that happen to contain `gpt`.
    pattern: /\bgpt-\d+\.\d+(?:-[a-z0-9]+)*\b/gi,
    message:
      "ハードコードされた OpenAI model slug (`gpt-X.Y` / `gpt-X.Y-codex`) が含まれています。" +
      "`harness model resolve <agent>` で解決した slug を参照するか、" +
      "`harness.config.json` の `models.codex.default` を通してください。" +
      "参照: `plugins/harness/core/src/models/resolver.ts` (HARNESS_DEFAULT_MODEL) / " +
      "`docs/maintainer/` の model registry 運用メモ。",
    appliesToTests: false,
    // Exempt the resolver source (declarative HARNESS_DEFAULT_MODEL) and
    // the schema directory (example slugs in field descriptions). These
    // are the model-registry source of truth by construction; enforcing
    // the rule there is a tautology. Using `skipFiles` avoids an inline
    // `generality-exemption: B-10 | …` comment in the resolver source,
    // which would itself carry the `B-10` tracker ID the rule otherwise
    // forbids.
    skipFiles: /^plugins\/harness\/(?:schemas\/|core\/src\/models\/resolver\.ts$)/,
  },
];

// ---------------------------------------------------------------------------
// Exemption 検出
// ---------------------------------------------------------------------------

// Markdown / TS コメント形式から exemption 宣言を抽出する regex。
// Unified exemption grammar: file-level と line-level で同一 keyword `generality-exemption` を使用。
// 旧 `generality-ok` keyword は廃止 (line-level でも受理されない)。
//
// File-head declarations MUST be anchored at the start of the file; only
// BOM (`﻿`), an optional shebang line, and whitespace are permitted
// between offset 0 and the opening `<!--` / `/*` marker. Once any other
// text appears, subsequent `<!-- generality-exemption: ... -->` blocks
// are treated as ordinary body content — they no longer satisfy the
// short-form inheritance precondition, so a maintainer cannot lift an
// inherited exemption by placing a block anywhere inside the 2048-byte
// head slice.
const EXEMPTION_FILE_HEAD_PATTERNS = [
  // Markdown: HTML comment anchored at the top of the file.
  /^(?:﻿)?(?:#![^\n]*\n)?\s*<!--\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*-->/,
  // TypeScript / JavaScript: block comment anchored at the top of the file.
  /^(?:﻿)?(?:#![^\n]*\n)?\s*\/\*\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*\*\//,
];

// Line-level exemption: TS 行コメント or 単一行 MD コメント
const EXEMPTION_LINE_PATTERNS: RegExp[] = [
  // TS line-comment: `// generality-exemption: ...` (行末まで body)
  /\/\/\s*generality-exemption\b\s*(?::\s*(.*?))?\s*$/,
  // MD inline comment: `<!-- generality-exemption: ... -->`
  /<!--\s*generality-exemption\b\s*(?::\s*([\s\S]*?))?\s*-->/,
];

interface ExemptionDeclaration {
  patternIds: Set<string>;
  issueKey: string;
  expiry: string;
  reason: string;
}

// Validation regex (hybrid design for semantic-slug issue keys): semantic-slug issue keys を許容、
// expiry は semver / ISO date / quarter の 3 書式を許容。
// Issue key: uppercase PREFIX, then hyphen, then alphanumeric / underscore / hyphen body.
// Slug forms (e.g. HARNESS-generality-self) are allowed for self-reference cases.
//
// exemption-grammar hardening hardening: cap BOTH prefix and suffix at 64 characters total
// each (Codex review major-1 follow-up). Capping only the suffix lets an
// attacker move a long credential-shaped payload before the hyphen — the
// prefix `[A-Z][A-Z0-9_]*` would otherwise still accept arbitrary length.
// 64 was chosen because realistic issue-key lengths sit well below it
// (HARNESS-generality-self = 17 chars, PARTS-12 = 8 chars), giving ample
// headroom while making credential-style obfuscation visible on either
// side of the hyphen.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}-[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const EXPIRY_SEMVER_RE = /^v\d+\.\d+\.\d+$/;
// exemption-grammar hardening hardening: tighten ISO date numeric-domain so impossible
// dates like 2026-13-32 (month 13, day 32) and 2026-04-00 (day zero) are
// rejected at parse time. We deliberately stop at numeric-domain checks
// (month 01-12 / day 01-31) rather than full Gregorian validation —
// adopting `Date.parse` here would invite locale / timezone footguns
// without protecting against the adversarial inputs the audit flagged.
// Edge cases that pass this regex but are not strict Gregorian (e.g.
// 2026-02-30, 2026-04-31) are handled by callers when / if they need
// month-day adjudication; the regex's job is to reject obvious junk.
const EXPIRY_ISO_DATE_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const EXPIRY_QUARTER_RE = /^\d{4}-Q[1-4]$/;
// `\d+` allows future expansion to 2+ digit pattern IDs (e.g. B-10, B-99a, B-123).
const PATTERN_ID_EXTRACT_RE = /\bB-\d+[a-z]?\b/g;
// Full-string CSV match for short-form idsPart: rejects any trailing/non-ID text
// so legacy fragments like "B-1, legacy reason" cannot bypass 4-field requirement.
const PATTERN_ID_CSV_RE = /^B-\d+[a-z]?(?:,B-\d+[a-z]?)*$/;
// exemption-grammar hardening hardening: scope the all-keyword guard to pattern-ids field
// grammar (CSV of B-\d+[a-z]? tokens). Previous shape `(?:^|\W)['"`]?all['"`]?
// (?:$|\W)` would also have flagged a legitimate issue-key like `ALL-42` if
// the regex were ever applied to the issue-key field. Anchoring the
// boundaries on `,` / `^` / `$` (the only legal token separators in a
// pattern-ids CSV) makes the regex unambiguously a pattern-ids field rule.
// Optional surrounding whitespace + optional ASCII quote chars stay because
// attackers historically wrap forbidden tokens to bypass naive matchers.
const ALL_KEYWORD_RE = /(?:^|,)\s*['"`]?all['"`]?\s*(?:$|,)/i;

/**
 * Parse an exemption body (everything after `generality-exemption:` up to closing marker).
 *
 * Canonical form: `<pattern-ids> | <issue-key> | <expiry> | <reason>` (4 pipe-separated fields).
 * Line-level short form (pattern-ids only; metadata inherited from file-head declaration) is
 * also permitted when `kind === "line"`. Any format violation throws; absence of an exemption
 * comment returns null (null is only reachable from the outer `parseExemption` / line matcher).
 */
function parseExemptionBody(
  rawBody: string | undefined,
  kind: "file" | "line",
): ExemptionDeclaration | null {
  if (rawBody === undefined) {
    throw new Error(
      "generality-exemption declaration body is required and cannot be undefined. " +
        "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | short reason`.",
    );
  }
  const body = rawBody.trim();
  if (!body || /^[\s*]+$/.test(body)) {
    throw new Error(
      "generality-exemption declaration requires explicit fields. " +
        "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | reason`. " +
        "Empty / whitespace-only body found (all characters were whitespace or `*`): '" +
        rawBody +
        "'",
    );
  }
  // Unified grammar is single-line — reject embedded `\r` / `\n` so neither
  // downstream grep tooling nor reviewers have to reconstruct multi-line
  // comments to parse an exemption. Applies to both file-head and
  // line-level forms (although line-level bodies never naturally carry
  // newlines, guarding here catches pathological CRLF injection).
  if (/[\r\n]/.test(body)) {
    throw new Error(
      "generality-exemption declaration must be a single line (no CR/LF inside the body). " +
        "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | reason`. Found multi-line body: " +
        JSON.stringify(body),
    );
  }
  // Unified exemption grammar migration: legacy 形式 (em-dash / multi-comma / file-level の pipe 無し) を reject
  if (!body.includes("|")) {
    // file-level では pipe + 4 fields が必須
    if (kind === "file") {
      throw new Error(
        "file-level generality-exemption must use pipe (`|`) as separator with 4 fields. " +
          "Form: `generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | reason`. Found: " +
          body,
      );
    }
    // line-level でも em-dash 混入は legacy として reject
    if (/[—–]/.test(body)) {
      throw new Error(
        "generality-exemption must use pipe (`|`) as separator. " +
          "Legacy em-dash form is no longer accepted. Found: " +
          body,
      );
    }
  }

  // Keep every raw split result so that leading / trailing / embedded
  // empty fields (`| B-1 | …`, `B-1 | … |`, `B-1 | | … |`) remain visible
  // to the count + non-empty checks below. A silent `filter` would collapse
  // those malformed inputs into an apparently valid 4-field declaration.
  const parts = body.split("|").map((s) => s.trim());
  if (parts.length === 0) {
    throw new Error(
      "generality-exemption body is empty after parsing. Found: " + body,
    );
  }

  // Line-level short form path is: `// generality-exemption: B-1,B-2a`
  // — no pipes, one element, non-empty. Anything else (even a stray
  // trailing pipe that produces `["B-1", ""]`) must flow into the
  // 4-field validation so it is rejected with an explicit diagnostic.
  const isShortFormCandidate =
    kind === "line" && parts.length === 1 && parts[0].length > 0;
  if (!isShortFormCandidate && parts.some((p) => p.length === 0)) {
    throw new Error(
      "generality-exemption must have exactly 4 non-empty pipe-separated fields: " +
        "`<pattern-ids> | <issue-key> | <expiry> | <reason>`. " +
        "Empty field(s) found in: [" +
        parts.map((p) => JSON.stringify(p)).join(", ") +
        "]",
    );
  }

  // pattern-ids field (parts[0]) の単独 validation。
  // `all` keyword / CSV shape の両方を pattern-ids field に限定することで、
  // reason 内の natural-language な `'all'` 言及や `legacy reason` 文字列を false-positive にしない。
  const idsPart = parts[0];

  // `all` は構造的欠陥なので禁止 — pattern-ids field のみ scope (reason field は free text)。
  if (ALL_KEYWORD_RE.test(idsPart)) {
    throw new Error(
      "generality-exemption `all` is prohibited in the pattern-ids field. " +
        "Declare explicit pattern IDs (e.g. `B-1,B-2a,B-3c`). Found: " +
        JSON.stringify(idsPart),
    );
  }

  const ids = Array.from(idsPart.matchAll(PATTERN_ID_EXTRACT_RE)).map(
    (m) => m[0],
  );
  if (ids.length === 0) {
    throw new Error(
      "generality-exemption must list explicit pattern IDs " +
        "(e.g. `B-1,B-2a`). None found in: " +
        idsPart,
    );
  }

  // idsPart は short form / 4-field form のいずれでも B-\d+[a-z]? の exact CSV である必要がある。
  // Legacy fragments like `B-1, legacy reason` or `,B-1 | ...` or `foo B-1 | ...` は
  // この anchor 付き regex で parse-time reject される。
  if (!PATTERN_ID_CSV_RE.test(idsPart)) {
    throw new Error(
      "generality-exemption pattern-ids field must be an exact CSV of pattern IDs " +
        "(e.g. `B-1,B-2a`). Trailing/interleaved non-ID text is not allowed; " +
        "use the explicit 4-field pipe form for metadata. Found: " +
        JSON.stringify(idsPart),
    );
  }

  // Line-level short form (pattern-ids only; metadata inherited from file-head declaration).
  // Semantic file-head inheritance check is performed by the caller (`hasLineExemption`) when
  // `fileContent` is supplied — this parser only rejects malformed short forms, while the
  // semantic void case (short form without a file-head declaration) is handled one layer up.
  if (kind === "line" && parts.length === 1) {
    return {
      patternIds: new Set(ids),
      issueKey: "",
      expiry: "",
      reason: "",
    };
  }

  // 4-field 厳格モード
  if (parts.length !== 4) {
    throw new Error(
      "generality-exemption must have exactly 4 pipe-separated fields: " +
        "`<pattern-ids> | <issue-key> | <expiry> | <reason>`. " +
        "Found " +
        parts.length +
        " field(s): [" +
        parts.map((p) => JSON.stringify(p)).join(", ") +
        "]",
    );
  }

  const [, issueKey, expiry, reason] = parts;

  if (!ISSUE_KEY_RE.test(issueKey)) {
    throw new Error(
      "generality-exemption issue-key must match `[A-Z][A-Z0-9_]*-[A-Za-z0-9_-]+` " +
        "(e.g. HARNESS-42, HARNESS-generality-self, PARTS-12). Found: " +
        JSON.stringify(issueKey),
    );
  }
  const expiryOk =
    EXPIRY_SEMVER_RE.test(expiry) ||
    EXPIRY_ISO_DATE_RE.test(expiry) ||
    EXPIRY_QUARTER_RE.test(expiry);
  if (!expiryOk) {
    throw new Error(
      "generality-exemption expiry must be semver (`vX.Y.Z`), ISO date (`YYYY-MM-DD`), " +
        "or quarter (`YYYY-Qn`). Found: " +
        JSON.stringify(expiry),
    );
  }
  if (!reason) {
    throw new Error(
      "generality-exemption reason is required and cannot be empty. Body: " +
        body,
    );
  }

  return { patternIds: new Set(ids), issueKey, expiry, reason };
}

// Head slice size: 2048 bytes gives ~10x buffer over a realistic file-head
// declaration (typical length ~200 chars for a 19-ID self-reference exemption).
// Raised from 800 after Codex adversarial review MAJOR-1: block-comment
// declarations whose closing `*/` sat beyond the 800-byte boundary were
// silently dropped by the non-greedy regex, causing exemptions to appear
// valid to humans while being ignored by the parser.
const EXEMPTION_HEAD_SLICE_BYTES = 2048;

function parseExemption(content: string): ExemptionDeclaration | null {
  const head = content.slice(0, EXEMPTION_HEAD_SLICE_BYTES);
  for (const re of EXEMPTION_FILE_HEAD_PATTERNS) {
    const match = re.exec(head);
    if (!match) continue;
    return parseExemptionBody(match[1], "file");
  }
  return null;
}

function hasFileExemption(content: string, patternId: string): boolean {
  const parsed = parseExemption(content);
  if (!parsed) return false;
  return parsed.patternIds.has(patternId);
}

/**
 * Check whether `line` carries a valid generality-exemption comment that
 * covers `patternId`.
 *
 * When `fileContent` is supplied, short-form line-level exemptions (where only
 * pattern-ids are given on the line itself) additionally require the
 * surrounding file to carry a valid 4-field file-head declaration that also
 * covers `patternId`. Without a file-head declaration the short form is
 * semantically void and is rejected so it cannot be used as an escape hatch.
 * If `fileContent` is omitted (parse-only call sites — existing unit tests),
 * the short form is accepted on purely syntactic validity — the caller
 * accepts responsibility for inheritance semantics.
 */
function hasLineExemption(
  line: string,
  patternId: string,
  fileContent?: string,
): boolean {
  for (const re of EXEMPTION_LINE_PATTERNS) {
    const match = re.exec(line);
    if (!match) continue;
    const parsed = parseExemptionBody(match[1], "line");
    if (!parsed) return false;
    if (!parsed.patternIds.has(patternId)) return false;

    // Short-form detection: a short-form declaration is syntactically a line-level
    // comment where only pattern-ids are given (no `|` separators were present,
    // so `issueKey` / `expiry` / `reason` were initialised to empty strings by
    // `parseExemptionBody`). Any of those empties being truthy means the full
    // 4-field form was used at line level and no inheritance check is needed.
    const isShortForm =
      parsed.issueKey === "" && parsed.expiry === "" && parsed.reason === "";
    if (isShortForm && fileContent !== undefined) {
      const fileHead = parseExemption(fileContent);
      if (!fileHead) return false;
      if (!fileHead.patternIds.has(patternId)) return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ファイル走査
// ---------------------------------------------------------------------------

function listFiles(target: ScopeTarget): string[] {
  const abs = resolve(PLUGIN_ROOT, target.dir);
  if (!existsSync(abs)) return [];
  const entries = readdirSync(abs);
  const files: string[] = [];
  for (const name of entries) {
    const full = join(abs, name);
    const st = statSync(full);
    if (st.isFile()) {
      if (target.exts.some((ext) => name.endsWith(ext))) {
        files.push(full);
      }
    } else if (st.isDirectory() && target.recursive) {
      // __tests__ は WARN_TARGETS で別扱い、重複を避ける
      if (name === "__tests__") continue;
      files.push(...listFiles({ ...target, dir: join(target.dir, name) }));
    }
  }
  return files;
}

/**
 * REPO-level targets: PLUGIN_ROOT 外の repo root 直下 (README.md / docs/en / docs/ja 等)。
 * Codex [C-1] 指摘: 定義のみで使われていなかった死コードを実装と統合。
 */
interface RepoRootTarget {
  relativePath: string; // REPO_ROOT からの相対
  exts: string[];
  recursive: boolean;
}

const REPO_ROOT_TARGETS: RepoRootTarget[] = [
  { relativePath: "README.md", exts: [".md"], recursive: false },
  { relativePath: "docs/en", exts: [".md"], recursive: true },
  { relativePath: "docs/ja", exts: [".md"], recursive: true },
];

function listRepoRootFiles(target: RepoRootTarget): string[] {
  const abs = resolve(REPO_ROOT, target.relativePath);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) {
    return target.exts.some((ext) => abs.endsWith(ext)) ? [abs] : [];
  }
  if (!st.isDirectory()) return [];
  const files: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = join(abs, name);
    const childStat = statSync(full);
    if (childStat.isFile()) {
      if (target.exts.some((ext) => name.endsWith(ext))) files.push(full);
    } else if (childStat.isDirectory() && target.recursive) {
      files.push(
        ...listRepoRootFiles({
          ...target,
          relativePath: join(target.relativePath, name),
        }),
      );
    }
  }
  return files;
}

function findHits(
  content: string,
  pattern: BlockPattern,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = content.split(/\r?\n/);
  const re = new RegExp(pattern.pattern.source, pattern.pattern.flags);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Pass full `content` so short-form line exemptions are validated against
    // the file-head 4-field declaration (inheritance semantics).
    if (hasLineExemption(line, pattern.id, content)) continue;
    // 各行で regex match (g フラグなので reset 不要に lastIndex=0)
    re.lastIndex = 0;
    const lineMatches = line.match(re);
    if (lineMatches && lineMatches.length > 0) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// test-file zone scan: test-file zone extraction
// ---------------------------------------------------------------------------
//
// Extract `comment-block` (`/* ... */`), `comment-line` (`// ...`), and
// `describe-title` (first string arg of `describe(...)` / `it(...)`)
// zones from a test file so the blocklist scan can focus on the surfaces
// most likely to leak internal tracker IDs (multi-line block comments
// span newlines and a per-line scan misses violations that wrap).
//
// Non-goals:
//   - Full TypeScript / JavaScript parsing. We deliberately stay at a
//     regex-based extractor; a full AST would couple this CI guard to
//     the project's bundler config.
//   - Comment detection inside string literals (e.g. a string that
//     contains `// foo`). False positives here are tolerable because
//     fixture string literals are already covered by file-head
//     `generality-exemption` declarations.

interface TestZone {
  kind: "comment-block" | "comment-line" | "describe-title";
  startLine: number;
  endLine: number;
  text: string;
  /** Absolute character offset of zone start in the original content. */
  startOffset: number;
}

/**
 * Compute the 1-based line number for a character offset by counting
 * newline characters up to but not including the offset.
 */
function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Extract zones from `content`. Implementation walks the string with a
 * tiny state machine so it can:
 *   - Skip over JS string literals (so `// inside string` is not flagged
 *     as a comment).
 *   - Recognise template literals (backticks) for describe / it titles.
 *   - Spot describe / it call boundaries before entering string state so
 *     the title's quote character is captured.
 *
 * The state machine is deliberately conservative: anything that looks
 * ambiguous defaults to "outside" so the extractor never mis-identifies
 * code as a comment / title (false-positives in the audit are far worse
 * than misses, since the audit also has the per-line BLOCKLIST_TARGETS
 * scan as a redundant net).
 */
export function extractTestZones(content: string): TestZone[] {
  const zones: TestZone[] = [];
  const len = content.length;
  let i = 0;
  while (i < len) {
    const ch = content[i];
    const next = content[i + 1];

    // ----- block comment -----
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < len) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 2;
          break;
        }
        i += 1;
      }
      const end = i;
      const startLine = offsetToLine(content, start);
      const endLine = offsetToLine(content, end - 1);
      zones.push({
        kind: "comment-block",
        startLine,
        endLine,
        startOffset: start,
        // Strip the comment markers so the regex sees only the body
        // text — the markers themselves never carry a tracker ID and
        // would otherwise leak into hit text reporting.
        text: content.slice(start + 2, end - 2),
      });
      continue;
    }

    // ----- line comment -----
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < len && content[i] !== "\n") i += 1;
      const end = i; // newline excluded
      const line = offsetToLine(content, start);
      zones.push({
        kind: "comment-line",
        startLine: line,
        endLine: line,
        startOffset: start,
        text: content.slice(start + 2, end),
      });
      continue;
    }

    // ----- string literal (skip body) -----
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < len) {
        if (content[i] === "\\") {
          // Escape sequence — skip the next character verbatim.
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // ----- describe / it title -----
    // Match the call form `describe("...")` / `it("...")` — first
    // string-literal argument only. We deliberately consume any
    // surrounding whitespace so multi-arg formatting (`describe (\n
    // "title", ...)`) still works.
    //
    // Codex Track-C review (major-2) follow-up: also support Vitest
    // modifier chains (`it.only(...)`, `describe.skip(...)`,
    // `it.each(...)`, `it.concurrent(...)`, `it.todo(...)`). After
    // matching the keyword, consume an allowlisted modifier path
    // before requiring `(`. The allowlist intentionally covers the
    // common test-runner forms so we do not silently extend coverage
    // to arbitrary chained property access.
    //
    // Codex Track-C confirm review follow-up: support `.each(cases)(
    // "title", ...)` curried form. When the consumed modifier chain
    // ended with `each`, the first `(...)` is the cases tuple — skip
    // it and look for a SECOND `(` whose first arg is the title.
    if (
      (ch === "d" || ch === "i") &&
      isDescribeOrItKeyword(content, i)
    ) {
      // Advance past the keyword.
      const kwLen = content.startsWith("describe", i) ? 8 : 2;
      let j = i + kwLen;
      const TEST_MODIFIERS = ["only", "skip", "concurrent", "each", "todo"];
      let lastModifier: string | undefined;
      while (content[j] === "." && j + 1 < len) {
        const remaining = content.slice(j + 1);
        const matchedModifier = TEST_MODIFIERS.find((mod) =>
          remaining.startsWith(mod) &&
          // Ensure the modifier ends at a non-word char (avoids
          // partial-match like `.skipper`).
          !/\w/.test(remaining[mod.length] ?? ""),
        );
        if (!matchedModifier) break;
        lastModifier = matchedModifier;
        j += 1 + matchedModifier.length;
      }
      // Skip whitespace + open paren.
      while (j < len && /\s/.test(content[j])) j += 1;
      if (content[j] !== "(") {
        // Not a call shape — keep walking from after the keyword to
        // avoid re-scanning the same span repeatedly.
        i = j;
        continue;
      }
      j += 1;

      // For `.each(cases)(<title>, ...)` we need to skip the cases
      // argument list and re-anchor on the second `(`. We do a depth-
      // tracking paren walk that respects nested string literals so a
      // cases array containing `[")"]` does not confuse the matcher.
      if (lastModifier === "each") {
        let depth = 1;
        while (j < len && depth > 0) {
          const c = content[j];
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === '"' || c === "'" || c === "`") {
            const innerQuote = c;
            j += 1;
            while (j < len) {
              if (content[j] === "\\") {
                j += 2;
                continue;
              }
              if (content[j] === innerQuote) {
                j += 1;
                break;
              }
              j += 1;
            }
            continue;
          }
          if (c === "(") depth += 1;
          else if (c === ")") depth -= 1;
          j += 1;
        }
        // After exiting the outer `)`, advance to the second `(`.
        while (j < len && /\s/.test(content[j])) j += 1;
        if (content[j] !== "(") {
          // `.each(cases)` not followed by curried call — skip extraction.
          i = j;
          continue;
        }
        j += 1;
      }

      while (j < len && /\s/.test(content[j])) j += 1;
      const titleQuote = content[j];
      if (titleQuote !== '"' && titleQuote !== "'" && titleQuote !== "`") {
        // First arg is not a string literal — skip.
        i = j;
        continue;
      }
      const titleStart = j + 1;
      let k = titleStart;
      while (k < len) {
        if (content[k] === "\\") {
          k += 2;
          continue;
        }
        if (content[k] === titleQuote) break;
        k += 1;
      }
      const titleEnd = k; // exclusive of closing quote
      const startLine = offsetToLine(content, titleStart);
      const endLine = offsetToLine(content, titleEnd);
      zones.push({
        kind: "describe-title",
        startLine,
        endLine,
        startOffset: titleStart,
        text: content.slice(titleStart, titleEnd),
      });
      // Resume after the closing quote.
      i = titleEnd + 1;
      continue;
    }

    i += 1;
  }
  return zones;
}

/**
 * `describe`/`it` keyword detector with word-boundary check (avoids
 * matching identifiers like `description` / `itinerary`).
 */
function isDescribeOrItKeyword(content: string, i: number): boolean {
  const isDescribe = content.startsWith("describe", i);
  const isIt = content.startsWith("it", i);
  if (!isDescribe && !isIt) return false;
  // Left boundary: previous char must NOT be a word char (so `xdescribe`
  // is not picked up).
  if (i > 0 && /\w/.test(content[i - 1])) return false;
  // Right boundary: char after the keyword must NOT be a word char
  // (so `description` is rejected; `describe(` / `describe (` survive).
  const after = content[i + (isDescribe ? 8 : 2)];
  if (after !== undefined && /[\w$]/.test(after)) return false;
  return true;
}

/**
 * Test-zone hit. `kind` carries the originating zone's classification
 * so audit messages can quote the precise surface.
 */
interface ZoneHit {
  kind: TestZone["kind"];
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Run a `BlockPattern`'s regex against each extracted zone in `content`,
 * honouring file-head `generality-exemption` declarations the same way
 * `findHits` does (so a fixture file that opts out of `B-3b` does not
 * produce zone hits).
 *
 * Multi-line zones (block comments) are searched with the regex's `s`
 * (dotAll) semantics emulated via `\s\S` in the original patterns —
 * since `\s` matches newline, the block-comment text can be tested
 * verbatim.
 *
 * Codex Track-C review (minor-1) follow-up: also honour line-level
 * `// generality-exemption: B-N | …` declarations on comment-line
 * zones. The original line carrying the comment (reconstructed by
 * prepending `//` since the zone strips comment markers) is fed to
 * `hasLineExemption(line, patternId, content)` so both full-form and
 * short-form (file-head inheritance) exemptions are recognised.
 *
 * Block-comment zones intentionally do NOT support line-level exemption
 * comments inside the body — block-local exemption semantics would
 * require per-line tokenisation that contradicts the multi-line catch
 * goal. Use file-head exemption for block-comment intentional fixtures.
 */
export function findHitsInTestZones(
  content: string,
  pattern: BlockPattern,
): ZoneHit[] {
  // File-head exemption applies to the entire file.
  if (hasFileExemption(content, pattern.id)) return [];
  const zones = extractTestZones(content);
  const lines = content.split(/\r?\n/);
  const hits: ZoneHit[] = [];
  for (const zone of zones) {
    // Re-instantiate the regex per zone so `lastIndex` from previous
    // zones / tests does not affect this match.
    const re = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    if (!re.test(zone.text)) continue;

    // For comment-line zones we can map the zone back to its original
    // line and consult `hasLineExemption`. describe-title and
    // comment-block zones may span multiple physical lines and do not
    // support line-level exemption (use file-head exemption instead).
    if (zone.kind === "comment-line" && zone.startLine - 1 < lines.length) {
      const originalLine = lines[zone.startLine - 1] ?? "";
      if (hasLineExemption(originalLine, pattern.id, content)) {
        continue;
      }
    }

    hits.push({
      kind: zone.kind,
      startLine: zone.startLine,
      endLine: zone.endLine,
      text: zone.text,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// テスト生成
// ---------------------------------------------------------------------------

function describeFileBlocklistTests(
  scopeName: string,
  targets: ScopeTarget[],
  patternFilter: (p: BlockPattern) => boolean = () => true,
): void {
  describe(`generality blocklist: ${scopeName}`, () => {
    const allFiles = targets.flatMap((t) =>
      listFiles(t).map((f) => ({ target: t, file: f })),
    );

    for (const pattern of BLOCK_PATTERNS) {
      if (!patternFilter(pattern)) continue;

      describe(`[${pattern.id}] ${pattern.category}`, () => {
        for (const { file } of allFiles) {
          // Normalise path separators so the skipFiles regex + describe
          // title stay consistent across Unix and Windows
          // (`plugins\harness\...` vs `plugins/harness/...`).
          const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
          it(`${rel} に ${pattern.id} が含まれない`, () => {
            if (pattern.skipFiles && pattern.skipFiles.test(rel)) {
              return;
            }
            const content = readFileSync(file, "utf-8");
            if (hasFileExemption(content, pattern.id)) {
              return;
            }
            const hits = findHits(content, pattern);
            if (hits.length > 0) {
              const details = hits
                .map((h) => `  L${h.line}: ${h.text}`)
                .join("\n");
              const fullMessage = `\n${pattern.message}\n\nLeak 検出箇所 (${rel}):\n${details}\n`;
              expect.fail(fullMessage);
            }
          });
        }
      });
    }
  });
}

// BLOCKLIST_TARGETS は全 pattern 適用
describeFileBlocklistTests("shipped spec (agents / commands / hooks)", BLOCKLIST_TARGETS);

// WARN_TARGETS (__tests__) は appliesToTests=true の pattern のみ適用
describeFileBlocklistTests(
  "tests describe 文 (内部 ID / ブランチ名漏れ防止)",
  WARN_TARGETS,
  (p) => p.appliesToTests,
);

// test-file zone scan: test-file zone scan
//
// The line-based WARN_TARGETS scan above misses multi-line `/* ... */`
// block-comment violations whose tracker fragment wraps across newlines
// (e.g. `/* internal\n申送 M-12 */`). This dedicated scan extracts
// comment + describe / it title zones first and runs the regex against
// each zone's full text so multi-line violations are caught. File-head
// `generality-exemption` declarations apply identically (the existing
// audit-tagged fixtures stay green).
describe("generality blocklist: test-file zones (zone scan multi-line catch)", () => {
  const allFiles = WARN_TARGETS.flatMap((t) => listFiles(t));

  for (const pattern of BLOCK_PATTERNS) {
    if (!pattern.appliesToTests) continue;
    describe(`[${pattern.id}] ${pattern.category}`, () => {
      for (const file of allFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        it(`${rel} の comment / describe-title に ${pattern.id} が含まれない`, () => {
          if (pattern.skipFiles && pattern.skipFiles.test(rel)) return;
          const content = readFileSync(file, "utf-8");
          const hits = findHitsInTestZones(content, pattern);
          if (hits.length > 0) {
            const details = hits
              .map(
                (h) =>
                  `  ${h.kind} L${h.startLine}-${h.endLine}: ${h.text
                    .slice(0, 200)
                    .replace(/\s+/g, " ")
                    .trim()}`,
              )
              .join("\n");
            const fullMessage = `\n${pattern.message}\n\nLeak 検出箇所 (${rel}):\n${details}\n`;
            expect.fail(fullMessage);
          }
        });
      }
    });
  }
});

// Codex [C-1] 指摘対応: REPO_ROOT_TARGETS (README.md / docs/en / docs/ja) を実際に走査
describe("generality blocklist: repo-level public docs (Codex [C-1] coverage)", () => {
  const repoFiles = REPO_ROOT_TARGETS.flatMap((t) => listRepoRootFiles(t));

  for (const pattern of BLOCK_PATTERNS) {
    // docs/ja は日本語翻訳ディレクトリなので B-7/B-10 系は適用外 (既に B-10 は削除済)
    // ただし B-1..B-5 / B-8 / B-9 は docs でも禁止 (leak 対象)
    describe(`[${pattern.id}] ${pattern.category}`, () => {
      for (const file of repoFiles) {
        const rel = relative(REPO_ROOT, file);
        // docs/ja/** は日本語が正当なので B-7 (日本語 UI keyword hardcode in hooks) は対象外 (そもそも TS でない)
        // docs/ja/** / docs/en/** 両方で branch / legacy-api / tracker-id / project-file / web-stack は禁止
        it(`${rel} に ${pattern.id} が含まれない`, () => {
          const content = readFileSync(file, "utf-8");
          if (hasFileExemption(content, pattern.id)) {
            return;
          }
          const hits = findHits(content, pattern);
          if (hits.length > 0) {
            const details = hits
              .map((h) => `  L${h.line}: ${h.text}`)
              .join("\n");
            const fullMessage = `\n${pattern.message}\n\nLeak 検出箇所 (${rel}):\n${details}\n`;
            expect.fail(fullMessage);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 自己検証: テスト基盤そのものが正しく動くか
// ---------------------------------------------------------------------------

describe("generality test harness 自体の健全性", () => {
  it("BLOCK_PATTERNS の id が全て unique", () => {
    const ids = BLOCK_PATTERNS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("各 pattern の regex に global flag (g) が付いている", () => {
    for (const p of BLOCK_PATTERNS) {
      expect(p.pattern.flags).toContain("g");
    }
  });

  it("BLOCKLIST_TARGETS の各ディレクトリが実在する", () => {
    for (const t of BLOCKLIST_TARGETS) {
      const abs = resolve(PLUGIN_ROOT, t.dir);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it("exemption 検出が正しく動作する (file-head + line)", () => {
    const exemptedMd = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | example only -->\n\nfeature/new-partslist`;
    expect(hasFileExemption(exemptedMd, "B-1")).toBe(true);
    expect(hasFileExemption(exemptedMd, "B-2a")).toBe(false);

    const lineExempted = `const branch = "feature/new-partslist"; // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture`;
    expect(hasLineExemption(lineExempted, "B-1")).toBe(true);
    expect(hasLineExemption(lineExempted, "B-2a")).toBe(false);

    const lineExemptedShort = `const branch = "feature/new-partslist"; // generality-exemption: B-1`;
    expect(hasLineExemption(lineExemptedShort, "B-1")).toBe(true);

    const nonExempted = `const branch = "feature/new-partslist";`;
    expect(hasLineExemption(nonExempted, "B-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unified exemption grammar — `|` separator + 4 必須フィールド
// ---------------------------------------------------------------------------

describe("exemption grammar (unified, pipe-separated)", () => {
  describe("file-level", () => {
    it("accepts valid syntax with 4 fields (semver expiry)", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
      expect(hasFileExemption(md, "B-2a")).toBe(true);
      expect(hasFileExemption(md, "B-3")).toBe(false);
    });

    it("accepts ISO date expiry", () => {
      const md = `<!-- generality-exemption: B-4a | HARNESS-99 | 2026-12-31 | time-bound rationale -->`;
      expect(hasFileExemption(md, "B-4a")).toBe(true);
    });

    it("accepts quarterly expiry (YYYY-Qn)", () => {
      const md = `<!-- generality-exemption: B-5 | HARNESS-10 | 2026-Q2 | quarter-bound rationale -->`;
      expect(hasFileExemption(md, "B-5")).toBe(true);
    });

    it("accepts TS block-comment form", () => {
      const content = `/* generality-exemption: B-6 | HARNESS-7 | v1.0.0 | block-comment form */`;
      expect(hasFileExemption(content, "B-6")).toBe(true);
    });

    it("accepts semantic slug issue-key (backward-compat for HARNESS-generality-self)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-generality-self | 2099-12-31 | detector self-reference -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
    });

    it("accepts cross-project issue-key prefix (e.g. PARTS-12)", () => {
      const md = `<!-- generality-exemption: B-1 | PARTS-12 | v1.0.0 | multi-project tracking -->`;
      expect(hasFileExemption(md, "B-1")).toBe(true);
    });

    it("throws when issue-key field is missing (only 3 fields present)", () => {
      const md = `<!-- generality-exemption: B-1 | v0.5.0 | reason text -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
    });

    it("throws when expiry field is missing", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | just a reason here -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
    });

    it("throws when reason field is missing (only 3 fields)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/reason/i);
    });

    it("throws when issue-key format is invalid (bare digits, no PREFIX-)", () => {
      const md = `<!-- generality-exemption: B-1 | 42 | v0.5.0 | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
    });

    it("throws when expiry is freeform text (not semver / ISO / quarter)", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | someday | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
    });

    it("throws when `all` appears in pattern-id field (existing guard preserved)", () => {
      const md = `<!-- generality-exemption: all | HARNESS-42 | v0.5.0 | reason -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/all/i);
    });

    it("throws when legacy em-dash + comma form is used (pipe is mandatory)", () => {
      const md = `<!-- generality-exemption: B-1 — HARNESS-42, v0.5.0, legacy format -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/pipe|\|/i);
    });

    it("throws when legacy 2-field form (`B-1, reason`) is used", () => {
      const md = `<!-- generality-exemption: B-1, example only -->`;
      expect(() => hasFileExemption(md, "B-1")).toThrow(/pipe|\|/i);
    });
  });

  describe("line-level", () => {
    it("accepts full 4-field form at line level", () => {
      const line = `const x = "feature/foo"; // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | fixture`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
      expect(hasLineExemption(line, "B-2")).toBe(false);
    });

    it("accepts short form with pattern-ids only (metadata inherits from file-head)", () => {
      const line = `const x = "feature/foo"; // generality-exemption: B-1,B-2a`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
      expect(hasLineExemption(line, "B-2a")).toBe(true);
      expect(hasLineExemption(line, "B-3")).toBe(false);
    });

    it("throws when line-level exemption lacks any pattern-id", () => {
      const line = `const x = "feature/foo"; // generality-exemption: free text only`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("rejects `all` at line level as well", () => {
      const line = `const x = "feature/foo"; // generality-exemption: all | reason`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(/all/i);
    });

    it("legacy `generality-ok` keyword is no longer accepted (unified to generality-exemption)", () => {
      const line = `const x = "feature/foo"; // generality-ok: legacy reason`;
      expect(hasLineExemption(line, "B-1")).toBe(false);
    });

    it("MD-form line-level exemption (<!-- ... -->) works too", () => {
      const line = `feature/foo <!-- generality-exemption: B-1 -->`;
      expect(hasLineExemption(line, "B-1")).toBe(true);
    });

    // ------------------------------------------------------------
    // Regression: short-form parser strictness
    // ------------------------------------------------------------
    // Short form (pattern-ids only) must:
    //   (1) Accept ONLY an exact CSV of B-\d+[a-z]? pattern IDs.
    //       Any trailing / interleaved non-ID text MUST be rejected
    //       so legacy fragments like "B-1, legacy reason" cannot bypass
    //       the 4-field requirement via the short-form escape hatch.
    //   (2) Require that the surrounding file has a valid 4-field
    //       file-head declaration when `fileContent` is supplied
    //       (the short-form metadata is defined to *inherit* from the
    //       file head; without one the short form is semantically void).
    // Signature note: `hasLineExemption(line, patternId, fileContent?)`
    // keeps `fileContent` optional so the existing parse-only tests
    // above (no surrounding file context) keep their meaning — those
    // check syntactic parseability only. Production scan (`findHits`)
    // always passes `fileContent` and gets the full semantic check.
    it("short form rejects malformed idsPart with trailing non-ID text ('B-1, legacy reason')", () => {
      const line = `const x = "foo"; // generality-exemption: B-1, legacy reason`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(
        /short form|exact CSV|pattern ID/i,
      );
    });

    it("short form rejects when fileContent has no valid file-head declaration", () => {
      const line = `const x = "foo"; // generality-exemption: B-1`;
      const fileContent = `plain content without any file-head generality-exemption comment`;
      expect(hasLineExemption(line, "B-1", fileContent)).toBe(false);
    });

    it("short form accepts when fileContent carries a valid 4-field file-head declaration", () => {
      const line = `const x = "foo"; // generality-exemption: B-1`;
      const fileContent = `/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | inherited metadata */\nconst x = "foo";`;
      expect(hasLineExemption(line, "B-1", fileContent)).toBe(true);
    });

    it("short form rejects when fileContent file-head declaration does NOT cover requested patternId", () => {
      const line = `const x = "foo"; // generality-exemption: B-2`;
      const fileContent = `/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | only B-1 exempted */\nconst x = "foo";`;
      expect(hasLineExemption(line, "B-2", fileContent)).toBe(false);
    });

    // ------------------------------------------------------------
    // Unicode / look-alike attack-surface invariants for pattern-id parsing.
    //
    // The parser must treat pattern IDs as strict ASCII `B-\d+[a-z]?` tokens.
    // The assertions below lock in that invariant against common bypass
    // vectors (homoglyph letters, zero-width spaces, leading/trailing commas
    // in CSV, and fullwidth pipe look-alikes) so future refactoring cannot
    // accidentally regress them.
    // ------------------------------------------------------------
    it("invariant: Cyrillic look-alike `В-` (U+0412) is rejected — ASCII-only pattern IDs", () => {
      const line = `const x = "foo"; // generality-exemption: В-1`;
      // Cyrillic В is not matched by \b B-\d+ \b; parser finds no pattern IDs → throws.
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("invariant: zero-width space (U+200B) inside idsPart is rejected", () => {
      const zwsp = "​";
      const line = `const x = "foo"; // generality-exemption: B${zwsp}-1`;
      // ZWSP between B and - breaks the \b B- boundary; parser finds no pattern IDs → throws.
      expect(() => hasLineExemption(line, "B-1")).toThrow(/pattern[- ]?id/i);
    });

    it("invariant: leading / trailing comma in CSV idsPart is rejected", () => {
      const lineLead = `const x = "foo"; // generality-exemption: ,B-1`;
      const lineTrail = `const x = "foo"; // generality-exemption: B-1,`;
      expect(() => hasLineExemption(lineLead, "B-1")).toThrow(/short form|exact CSV|pattern ID/i);
      expect(() => hasLineExemption(lineTrail, "B-1")).toThrow(/short form|exact CSV|pattern ID/i);
    });

    it("invariant: fullwidth pipe `｜` (U+FF5C) does not bypass the ASCII pipe requirement", () => {
      const content = `/* generality-exemption: B-1｜HARNESS-42｜v0.5.0｜reason */`;
      // body.includes("|") treats ASCII pipe only; fullwidth form drops into
      // short-form branch and is then rejected by PATTERN_ID_CSV_RE.
      expect(() => hasFileExemption(content, "B-1")).toThrow();
    });

    // ------------------------------------------------------------
    // Slice-boundary + strict-head invariants.
    //
    // (1) Non-greedy `[\s\S]*?` + strict `^`-anchored regex must still
    //     detect a long declaration whose closing marker sits far from
    //     offset 0 — padding AFTER the declaration is irrelevant, the
    //     head slice (2048 bytes) must be wide enough to see the close.
    // (2) Padding BEFORE the declaration (the inverse) MUST push the
    //     block out of file-head scope even when the declaration closes
    //     inside the 2048-byte slice. Tested in
    //     "file-head strict anchoring + pipe empty-field rejection"
    //     below — kept separate because the invariant is semantic, not
    //     just slice-size.
    // ------------------------------------------------------------
    it("file-head declaration with long reason still fits the 2048-byte slice", () => {
      const longReason = "x".repeat(1500);
      const content = `/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | ${longReason} */\n`;
      expect(hasFileExemption(content, "B-1")).toBe(true);
    });

    it("docstring sample with exemption-like text must NOT be misread as a declaration", () => {
      // Regression: when the head slice was widened from 800 to 2048 bytes to
      // fix MAJOR-1, a non-anchored regex would greedily match documentation
      // samples inside an adjacent docstring (e.g. ` * Sample: <!-- generality-exemption: ... -->`).
      // The line-start anchor on EXEMPTION_FILE_HEAD_PATTERNS must prevent that.
      const content = `/**\n * Format reference:\n * - File-head Markdown: <!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | sample -->\n */\nconst something = 1;\n`;
      // There is no real file-head declaration here — only a docstring sample.
      expect(hasFileExemption(content, "B-1")).toBe(false);
    });
  });

  describe("parser return shape", () => {
    it("parseExemption returns { patternIds, issueKey, expiry, reason } on success", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.patternIds.has("B-1")).toBe(true);
      expect(parsed!.patternIds.has("B-2a")).toBe(true);
      expect(parsed!.issueKey).toBe("HARNESS-42");
      expect(parsed!.expiry).toBe("v0.5.0");
      expect(parsed!.reason).toBe("rationale");
    });

    it("returns null when no exemption present", () => {
      expect(parseExemption("plain content without exemption")).toBeNull();
    });
  });

  describe("pattern-ids field scoping (idsPart CSV strictness + all-keyword scope)", () => {
    // Both checks must operate on parts[0] (pattern-ids field) only, NOT on the full body.
    // Previous behavior scanned the entire body for the `all` keyword, which false-positively
    // rejected valid declarations whose reason field mentioned `all` as a word. It also skipped
    // CSV-shape validation for full 4-field declarations, letting malformed idsPart like
    // ",B-1 | ..." or "foo B-1 | ..." slip past the parser.
    it("rejects full-form idsPart with leading comma ',B-1 | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: ,B-1 | HARNESS-42 | v0.5.0 | leading comma -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("rejects full-form idsPart with non-ID prefix 'foo B-1 | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: foo B-1 | HARNESS-42 | v0.5.0 | non-ID prefix -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("rejects full-form idsPart with trailing suffix 'B-1 legacy | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: B-1 legacy | HARNESS-42 | v0.5.0 | trailing suffix -->`;
      expect(() => parseExemption(md)).toThrow(/exact CSV|pattern ID/i);
    });

    it("accepts full-form idsPart as exact CSV 'B-1,B-2a | HARNESS-42 | v0.5.0 | reason'", () => {
      const md = `<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | exact csv -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.patternIds.has("B-1")).toBe(true);
      expect(parsed!.patternIds.has("B-2a")).toBe(true);
    });

    it("reason field containing standalone 'all' does NOT trigger all-keyword rejection", () => {
      // Previously ALL_KEYWORD_RE.test(body) inspected the whole body, so a reason like
      // "rationale for 'all' exemptions" would throw. After scoping to parts[0], reason is free text.
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | rationale for 'all' exemptions -->`;
      const parsed = parseExemption(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.reason).toMatch(/all/);
      expect(parsed!.patternIds.has("B-1")).toBe(true);
    });

    it("idsPart equal to 'all' is still rejected (scoped check preserved)", () => {
      const md = `<!-- generality-exemption: all | HARNESS-42 | v0.5.0 | scoped all -->`;
      expect(() => parseExemption(md)).toThrow(/all/i);
    });

    it("idsPart containing 'all' plus real pattern-id is rejected (pattern-ids field hygiene)", () => {
      const md = `<!-- generality-exemption: all,B-1 | HARNESS-42 | v0.5.0 | mixed rejected -->`;
      expect(() => parseExemption(md)).toThrow(/all|exact CSV|pattern ID/i);
    });
  });

  describe("file-head strict anchoring + pipe empty-field rejection", () => {
    // CodeRabbit Round 2 findings: (a) file-head regex that only required a
    // line-start boundary inside the first 2048 bytes would lift arbitrary
    // non-head declarations into file-head scope (short-form inheritance
    // bypass). (b) `parts.filter((s) => s.length > 0)` silently collapsed
    // leading / trailing / embedded empty pipe fields, letting `| B-1 | … |
    // … | reason` parse as a valid 4-field declaration even though the
    // leading empty field should be rejected.

    it("file-head regex rejects a block comment that appears after real code", () => {
      // Declaration preceded by actual executable code ⇒ must NOT be
      // treated as file-head regardless of the 2048-byte slice.
      const content =
        'const harmless = 1;\n' +
        'console.log("still not a header");\n' +
        '/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | spoof attempt */\n' +
        'const x = "foo";\n';
      expect(hasFileExemption(content, "B-1")).toBe(false);
    });

    it("file-head regex rejects a MD comment placed after running content", () => {
      const content =
        '# Title\n' +
        '\n' +
        'Intro paragraph.\n' +
        '<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | spoof -->\n';
      expect(hasFileExemption(content, "B-1")).toBe(false);
    });

    it("file-head regex still accepts declaration preceded only by BOM + shebang + whitespace", () => {
      const content =
        "﻿" +
        "#!/usr/bin/env node\n" +
        "\n" +
        "/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | hardened head */\n" +
        "const x = 1;\n";
      expect(hasFileExemption(content, "B-1")).toBe(true);
    });

    it("short-form inheritance is NOT satisfied when declaration sits past real content (regression vs bypass)", () => {
      const fileContent =
        'const y = "bar";\n' +
        '/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 | not-at-head */\n' +
        'const x = "foo"; // generality-exemption: B-1\n';
      const line = `const x = "foo"; // generality-exemption: B-1`;
      expect(hasLineExemption(line, "B-1", fileContent)).toBe(false);
    });

    it("rejects full form with leading empty pipe field ('| B-1 | HARNESS-42 | v0.5.0 | reason')", () => {
      const md = `<!-- generality-exemption: | B-1 | HARNESS-42 | v0.5.0 | leading empty -->`;
      expect(() => parseExemption(md)).toThrow(/4|field|empty|pattern/i);
    });

    it("rejects full form with trailing empty pipe field ('B-1 | HARNESS-42 | v0.5.0 | reason |')", () => {
      const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | trailing empty | -->`;
      expect(() => parseExemption(md)).toThrow(/4|field|empty/i);
    });

    it("rejects full form with embedded empty pipe field ('B-1 | | v0.5.0 | reason')", () => {
      const md = `<!-- generality-exemption: B-1 | | v0.5.0 | embedded empty -->`;
      expect(() => parseExemption(md)).toThrow(/4|field|empty|issue/i);
    });

    it("rejects line-level short form with trailing pipe ('// generality-exemption: B-1 |')", () => {
      const line = `const x = "foo"; // generality-exemption: B-1 |`;
      expect(() => hasLineExemption(line, "B-1")).toThrow(
        /4|field|empty|exact CSV|pattern ID/i,
      );
    });

    // ------------------------------------------------------------
    // Single-line declaration invariant.
    //
    // Although `[\s\S]*?` in the file-head regex technically allows a
    // declaration body to span newlines, the unified grammar is
    // intentionally single-line so that neither grep nor downstream
    // tooling has to reconstruct multi-line comments to parse
    // exemptions. Reject `\r` and `\n` anywhere inside the captured
    // body at parse-time.
    // ------------------------------------------------------------
    it("rejects file-head declaration whose reason spans multiple lines (LF inside body)", () => {
      const content =
        "/* generality-exemption: B-1 | HARNESS-42 | v0.5.0 |\nwrapped reason */\nconst x = 1;\n";
      expect(() => hasFileExemption(content, "B-1")).toThrow(
        /single line|newline|line break|4|field/i,
      );
    });

    it("rejects file-head declaration with CR inside body", () => {
      const content =
        "<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | \r embedded CR -->\n";
      expect(() => hasFileExemption(content, "B-1")).toThrow(
        /single line|newline|line break|4|field/i,
      );
    });
  });

  // ----------------------------------------------------------------------
  // exemption-grammar hardening: exemption-grammar regex 強化
  // ----------------------------------------------------------------------
  // Background: legacy security follow-up (security). The three regex below were
  // accepting inputs that violated their semantic intent:
  //
  //   1. ISSUE_KEY_RE — no upper bound on suffix length, so a malicious or
  //      malformed declaration could embed a credential-shaped 200+ char
  //      string as the "issue-key" and slip past the parser. Cap suffix at
  //      64 characters (i.e. 1 leading char + up to 63 more).
  //   2. EXPIRY_ISO_DATE_RE — pure digit-shape matcher, so `2026-13-32`
  //      (month 13, day 32) and other impossible dates were accepted. Tighten
  //      to month 01-12 / day 01-31 (numeric-domain check; not strict
  //      Gregorian — Feb 30 / Apr 31 are still admissible).
  //   3. ALL_KEYWORD_RE — boundary scoping let a legitimate issue-key like
  //      `ALL-42` look like an `all`-keyword hit if the regex were ever
  //      tested against the issue-key field directly. Tighten to a CSV-
  //      bounded match so the regex is only meaningful in the pattern-ids
  //      field grammar (comma-separated tokens).
  //
  // These changes must NOT increase false-positives in the existing test
  // suite (running the whole generality.test.ts must stay green), so the
  // adversarial cases below are paired with positive cases that lock in
  // the previously accepted shapes.
  describe("exemption grammar regex hardening (exemption regex hardening)", () => {
    describe("ISSUE_KEY_RE suffix 64-char cap", () => {
      it("accepts a 64-character suffix (boundary)", () => {
        // Total suffix length = 64: 1 leading [A-Za-z0-9_] + 63 more.
        const suffix = "a".repeat(64);
        const md = `<!-- generality-exemption: B-1 | HARNESS-${suffix} | v0.5.0 | within cap -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });

      it("rejects a 65-character suffix (just over the cap)", () => {
        const suffix = "a".repeat(65);
        const md = `<!-- generality-exemption: B-1 | HARNESS-${suffix} | v0.5.0 | over cap -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
      });

      it("rejects a 200-character credential-shaped suffix (worst-case obfuscation)", () => {
        // Simulates an attacker stuffing a token / hash into the issue-key field.
        const credentialish = "X".repeat(200);
        const md = `<!-- generality-exemption: B-1 | HARNESS-${credentialish} | v0.5.0 | credential abuse -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
      });

      // Codex Track-C review (major-1) follow-up: the prefix `[A-Z][A-Z0-9_]*`
      // had no upper bound, so an attacker could move a long uppercase /
      // token-shaped payload BEFORE the hyphen and slip past the suffix
      // cap. Lock down the prefix at the same 64-character ceiling.
      it("rejects a 65-character prefix (just over the prefix cap)", () => {
        const prefix = "X".repeat(65); // only ASCII uppercase / digits / underscore allowed
        const md = `<!-- generality-exemption: B-1 | ${prefix}-42 | v0.5.0 | over prefix cap -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
      });

      it("rejects a 200-character credential-shaped prefix (worst-case obfuscation)", () => {
        const credentialish = "Z".repeat(200);
        const md = `<!-- generality-exemption: B-1 | ${credentialish}-9 | v0.5.0 | prefix abuse -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/issue[- ]?key/i);
      });

      it("accepts a 64-character prefix (boundary, prefix max)", () => {
        // 1 leading [A-Z] + 63 more = 64 total
        const prefix = "X".repeat(64);
        const md = `<!-- generality-exemption: B-1 | ${prefix}-42 | v0.5.0 | within prefix cap -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });

      it("still accepts pre-existing semantic-slug forms (HARNESS-generality-self)", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-generality-self | 2099-12-31 | preserved -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });

      it("still accepts cross-project tracker prefix (PARTS-12)", () => {
        const md = `<!-- generality-exemption: B-1 | PARTS-12 | v1.0.0 | preserved -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });
    });

    describe("EXPIRY_ISO_DATE_RE numeric-domain check", () => {
      it("rejects a malformed date with month 13", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-13-01 | invalid month -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
      });

      it("rejects a malformed date with month 00", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-00-15 | invalid month -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
      });

      it("rejects a malformed date with day 32", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-04-32 | invalid day -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
      });

      it("rejects a malformed date with day 00", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-04-00 | invalid day -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
      });

      it("rejects the canonical adversarial input 2026-13-32", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-13-32 | task fixture -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/expir/i);
      });

      it("accepts the boundary date 2026-12-31", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-12-31 | year-end -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });

      it("accepts the boundary date 2026-01-01", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | 2026-01-01 | year-start -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });

      it("accepts the existing fixture date 2099-12-31 (HARNESS-generality-self)", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-generality-self | 2099-12-31 | self -->`;
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });
    });

    describe("ALL_KEYWORD_RE pattern-id field scope", () => {
      it("rejects pattern-ids field equal to standalone 'all' (existing guard preserved)", () => {
        const md = `<!-- generality-exemption: all | HARNESS-42 | v0.5.0 | scoped all -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/all/i);
      });

      it("rejects pattern-ids CSV containing 'all' as a comma-bounded token", () => {
        const md = `<!-- generality-exemption: B-1,all,B-2a | HARNESS-42 | v0.5.0 | mixed -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/all|exact CSV|pattern ID/i);
      });

      it("rejects pattern-ids 'all,B-1' (leading all)", () => {
        const md = `<!-- generality-exemption: all,B-1 | HARNESS-42 | v0.5.0 | leading -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/all|exact CSV|pattern ID/i);
      });

      it("rejects pattern-ids 'B-1,all' (trailing all)", () => {
        const md = `<!-- generality-exemption: B-1,all | HARNESS-42 | v0.5.0 | trailing -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/all|exact CSV|pattern ID/i);
      });

      it("rejects quoted 'all' in pattern-ids field (`'all'`)", () => {
        const md = `<!-- generality-exemption: 'all' | HARNESS-42 | v0.5.0 | quoted -->`;
        expect(() => hasFileExemption(md, "B-1")).toThrow(/all|exact CSV|pattern ID/i);
      });

      it("does NOT false-positive when reason field mentions the word 'all' (preserved)", () => {
        const md = `<!-- generality-exemption: B-1 | HARNESS-42 | v0.5.0 | rationale for 'all' exemptions -->`;
        const parsed = parseExemption(md);
        expect(parsed).not.toBeNull();
        expect(parsed!.reason).toMatch(/all/);
      });

      it("does NOT false-positive when issue-key starts with 'ALL-' (e.g. ALL-42)", () => {
        // ALL_KEYWORD_RE must not flag legitimate issue-key shapes that happen
        // to begin with the letters A-L-L. Issue-key validation runs in its
        // own field; the all-keyword check must stay scoped to the pattern-ids
        // field so it cannot leak into issue-key adjudication.
        const md = `<!-- generality-exemption: B-1 | ALL-42 | v0.5.0 | tracker prefix -->`;
        // ALL-42 satisfies the issue-key regex and must NOT be rejected by
        // the all-keyword guard.
        expect(hasFileExemption(md, "B-1")).toBe(true);
      });
    });
  });

  // ----------------------------------------------------------------------
  // test-file zone scan: test-file comment / describe-title 走査拡張
  // ----------------------------------------------------------------------
  // Background: existing WARN_TARGETS line-based scan already catches a
  // tracker-ID violation when it sits on a single line of a test file
  // (the regex itself matches without comment-awareness). The audit
  // surfaced two gaps:
  //
  //   1. Multi-line `/* ... */` block-comment violations split across
  //      newlines (e.g. `/* internal\n申送 M-12 */`) are missed because
  //      the scan is per-line.
  //   2. The intent of WARN_TARGETS is "violations inside test files"
  //      but the scan currently looks at every line equally. Making the
  //      "comments + describe / it titles" surfaces explicit gives a
  //      precise hit message ("violation in comment block at L123-L130")
  //      and keeps fixture string literals separately handled (those
  //      are typically declared with file-head exemption).
  //
  // Implementation contract for the helpers under test:
  //   - `extractTestZones(content)` → ordered list of `{kind, startLine,
  //     endLine, text}` records covering:
  //       * `comment-block` — `/* ... */` body (multi-line allowed)
  //       * `comment-line` — `// ...` body (one per line)
  //       * `describe-title` — first string argument of `describe(...)` /
  //         `it(...)` calls (single-line literal, double / single /
  //         backtick quotes)
  //   - `findHitsInTestZones(content, pattern)` → array of hits (line
  //     ranges + matched text), exempt-aware (skips zones covered by
  //     file-head or in-zone `generality-exemption` markers).
  describe("test-file zone extraction (zone scan extension)", () => {
    it("extractTestZones returns block comments, line comments, and describe / it titles", () => {
      const src =
        '/* block start\n internal note */\n' +
        '// single line comment\n' +
        'describe("first describe title", () => {\n' +
        '  it("first it title", () => {});\n' +
        '});\n';
      const zones = extractTestZones(src);
      const kinds = zones.map((z) => z.kind);
      expect(kinds).toContain("comment-block");
      expect(kinds).toContain("comment-line");
      expect(kinds).toContain("describe-title");
      // describe-title and it-title are reported separately so callers
      // can quote the exact location.
      const titles = zones
        .filter((z) => z.kind === "describe-title")
        .map((z) => z.text);
      expect(titles).toEqual(
        expect.arrayContaining([
          "first describe title",
          "first it title",
        ]),
      );
    });

    it("extractTestZones spans block comment text across newlines", () => {
      const src = '/*\n  Round 4 of internal review\n  申送 M-12\n*/\nconst x = 1;\n';
      const zones = extractTestZones(src);
      const block = zones.find((z) => z.kind === "comment-block");
      expect(block).toBeDefined();
      expect(block!.text).toContain("Round 4");
      expect(block!.text).toContain("申送 M-12");
      // Line range covers the multi-line block.
      expect(block!.startLine).toBeLessThanOrEqual(block!.endLine);
      expect(block!.endLine).toBeGreaterThanOrEqual(2);
    });

    it("extractTestZones skips backslash-escaped quote inside describe title", () => {
      // Robustness: a `describe` title may legitimately contain an escaped
      // quote (e.g. `describe("foo \"bar\" baz", ...)`). Extraction must
      // not stop at the inner quote.
      const src = 'describe("foo \\"bar\\" baz", () => {});\n';
      const zones = extractTestZones(src);
      const titles = zones.filter((z) => z.kind === "describe-title");
      expect(titles).toHaveLength(1);
      expect(titles[0].text).toContain("bar");
    });

    it("extractTestZones recognises template-literal (backtick) describe titles", () => {
      const src = 'it(`backtick title with ${interp} stuff`, () => {});\n';
      const zones = extractTestZones(src);
      const titles = zones.filter((z) => z.kind === "describe-title");
      expect(titles).toHaveLength(1);
      expect(titles[0].text).toContain("backtick title");
    });

    // Codex Track-C review (major-2) follow-up: Vitest modifier chains
    // (`it.only(...)`, `describe.skip(...)`, `it.each(...)`) are real
    // surfaces that may carry test titles. Without explicit support the
    // C-3 zone scan would silently skip those titles even though they
    // are visible to the test runner. Cover the canonical modifiers
    // (`only`, `skip`, `concurrent`, `each`, `todo`).
    it("extractTestZones captures it.only / it.skip / describe.only modifier chains", () => {
      const src =
        'it.only("only title", () => {});\n' +
        'it.skip("skip title", () => {});\n' +
        'describe.only("describe-only title", () => {});\n' +
        'describe.skip("describe-skip title", () => {});\n';
      const zones = extractTestZones(src);
      const titles = zones
        .filter((z) => z.kind === "describe-title")
        .map((z) => z.text);
      expect(titles).toEqual(
        expect.arrayContaining([
          "only title",
          "skip title",
          "describe-only title",
          "describe-skip title",
        ]),
      );
    });

    it("extractTestZones captures it.concurrent / it.todo modifiers", () => {
      const src =
        'it.concurrent("concurrent title", () => {});\n' +
        'it.todo("todo title");\n';
      const zones = extractTestZones(src);
      const titles = zones
        .filter((z) => z.kind === "describe-title")
        .map((z) => z.text);
      expect(titles).toEqual(
        expect.arrayContaining(["concurrent title", "todo title"]),
      );
    });

    // Codex Track-C confirm review follow-up: `it.each(cases)("title", ...)`
    // is a curried Vitest / Jest call shape — `.each` returns a function
    // whose first arg is the title. The previous modifier handling only
    // entered the title-extraction path when the first call had a string
    // first arg, so parameterized test titles were silently skipped.
    it("extractTestZones captures it.each(cases)(<title>, ...) curried call shape", () => {
      const src =
        'it.each([[1]])("each Round 4 case", (n) => {});\n' +
        'describe.each(["a", "b"])("each describe variant %s", () => {});\n';
      const zones = extractTestZones(src);
      const titles = zones
        .filter((z) => z.kind === "describe-title")
        .map((z) => z.text);
      expect(titles).toEqual(
        expect.arrayContaining([
          "each Round 4 case",
          "each describe variant %s",
        ]),
      );
    });

    it("findHitsInTestZones flags a tracker-ID inside an it.each parameterised title (B-3b)", () => {
      const src = 'it.each([[1, 2], [3, 4]])("Round 4 case %i", (a, b) => {});\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits.length).toBeGreaterThan(0);
    });

    it("findHitsInTestZones detects a multi-line block-comment Round-N violation (B-3b)", () => {
      // Pre-extension: a per-line scan would still catch `Round 4` on its
      // own line, but the extension hardens this for cases like multi-line
      // `Round\n4` (regex `\s` does match `\n` but per-line tokenisation
      // of `findHits` cannot see across the boundary).
      const src = '/* internal note\n   Round\n   4\n   note */\nconst x = 1;\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits.length).toBeGreaterThan(0);
    });

    it("findHitsInTestZones detects a tracker-ID inside a describe title (B-3e)", () => {
      const src = 'describe("(C-1) some scenario", () => {});\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3e");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits.length).toBeGreaterThan(0);
    });

    it("findHitsInTestZones detects a tracker-ID inside an it() title", () => {
      const src = 'it("Round 4 regression check", () => {});\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits.length).toBeGreaterThan(0);
    });

    it("findHitsInTestZones honours file-head exemption (R3 generality-exemption)", () => {
      const src =
        '/* generality-exemption: B-3b | HARNESS-42 | v0.5.0 | fixture covers tracker pattern */\n' +
        '/* internal note: Round 4 */\n' +
        'describe("Round 4 review", () => {});\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      // Exempt by file-head declaration → no hits.
      expect(hits).toHaveLength(0);
    });

    // Codex Track-C review (minor-1) follow-up: per the helper's contract
    // ("exemption-aware like findHits"), line-level `// generality-
    // exemption: B-N | …` declarations on a comment-line zone must be
    // honoured too. Otherwise, a legitimate fixture comment that opted
    // out via the line-level form would still surface as a hit.
    it("findHitsInTestZones honours line-level full-form exemption on comment-line zones", () => {
      const src =
        '// Round 4 review // generality-exemption: B-3b | HARNESS-42 | v0.5.0 | fixture exempt\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits).toHaveLength(0);
    });

    it("findHitsInTestZones honours short-form line-level exemption when file-head covers patternId", () => {
      const src =
        '/* generality-exemption: B-3b | HARNESS-42 | v0.5.0 | head exempts B-3b */\n' +
        '// Round 4 // generality-exemption: B-3b\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits).toHaveLength(0);
    });

    it("findHitsInTestZones does NOT report when the tracker-ID lives outside any zone (e.g. raw code line)", () => {
      // Code-line literal (no comment / no describe) is intentionally NOT
      // scanned by the test-zone extension. Such literals are policed by
      // the per-line BLOCKLIST_TARGETS path (or accepted with an inline
      // line-level exemption); the test-zone helper focuses on
      // comments + describe / it titles.
      const src = 'const tracker = "Round 4";\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits).toHaveLength(0);
    });

    it("findHitsInTestZones produces zone-aware hit metadata (kind + line range)", () => {
      const src = '// Round 4 line comment\n';
      const pattern = BLOCK_PATTERNS.find((p) => p.id === "B-3b");
      expect(pattern).toBeDefined();
      const hits = findHitsInTestZones(src, pattern!);
      expect(hits.length).toBeGreaterThan(0);
      // Hit reports its zone kind + a non-empty line range.
      expect(hits[0].kind).toBe("comment-line");
      expect(hits[0].startLine).toBeGreaterThanOrEqual(1);
      expect(hits[0].endLine).toBeGreaterThanOrEqual(hits[0].startLine);
    });
  });

  // ─────────────── B-3f boundary regression (external review nitpick で固定) ───────────────
  // 外部 code review の nitpick で B-3f の境界 case を専用 regression test で固定する
  // よう推奨された (2 要件組合せで false-positive 回避の coding guideline)。
  // pattern `(?<![\w-])gen-\d+\b` の Node.js empirical 検証 (positive 1 + negative 5) を
  // CI に固定し、将来の regex 調整時の false-positive 回帰を防ぐ。
  describe("B-3f boundary regression (positive / negative match cases)", () => {
    const b3f = BLOCK_PATTERNS.find((p) => p.id === "B-3f");
    if (!b3f) {
      throw new Error("B-3f pattern is missing from BLOCK_PATTERNS");
    }
    const pat = b3f.pattern;

    // Helper: regex を `lastIndex` リセット付きで test (global flag 影響回避)
    const matches = (src: string): boolean => {
      pat.lastIndex = 0;
      return pat.test(src);
    };

    it("positive: `gen-13` 単独 (canonical session 世代 ID) は match する", () => {
      expect(matches("gen-13")).toBe(true);
    });

    it("positive: `(gen-13)` 括弧内 / ` gen-13 ` 前後 whitespace も match する", () => {
      expect(matches("(gen-13)")).toBe(true);
      expect(matches(" gen-13 ")).toBe(true);
    });

    it("negative: `next-gen-13` (compound prefix `next-`) は match しない (lookbehind blocks)", () => {
      expect(matches("next-gen-13")).toBe(false);
    });

    it("negative: `9th-gen-13` (compound prefix `9th-`) は match しない", () => {
      expect(matches("9th-gen-13")).toBe(false);
    });

    it("negative: `gen-13a` (suffix word char) は match しない (`\\b` 末尾)", () => {
      expect(matches("gen-13a")).toBe(false);
    });

    it("negative: `general-13` (gen prefix のみ、ハイフン不在) は match しない", () => {
      expect(matches("general-13")).toBe(false);
    });

    it("negative: `gen-1.3` (digits の後の `.`) は `gen-1` のみ match する (overflow しない)", () => {
      // global flag 付きなので全件抽出
      const m = "gen-1.3".match(new RegExp(pat.source, pat.flags));
      expect(m).toEqual(["gen-1"]);
    });

    it("negative: `regen-13` (word prefix `re`) は match しない (lookbehind blocks)", () => {
      expect(matches("regen-13")).toBe(false);
    });

    // ─── case variant defensive regression (sub-describe で分離、将来の `/gi` 化を CI で blocking) ───
    // 内部 session ID は lowercase ASCII で確立 (`gen-N`)。`Gen-N` / `GEN-N` /
    // mixed case は generic English (`Generation` / `Generic` / `Generator` /
    // `GEN-LOCK` 等の acronym) と衝突する false-positive リスク高のため、case
    // variant は **意図的に detect しない** 設計。誰かが pattern flag に `i` を
    // 追加した場合に本 sub-describe が fail し、PR を blocking する guardrail として
    // 機能する。lookbehind 由来の negative case (上の it 群) とは独立した別軸の
    // defensive guard なので nested describe で明示分離する。
    describe("case-sensitive variant guards (lookbehind とは独立、`/gi` 化 regression 検知用)", () => {
      it("negative: `Gen-13` (uppercase initial、generic English term collision risk e.g. Generation) は match しない", () => {
        expect(matches("Gen-13")).toBe(false);
      });

      it("negative: `GEN-13` (全大文字、acronym collision risk e.g. GEN-LOCK) は match しない", () => {
        expect(matches("GEN-13")).toBe(false);
      });

      it("negative: `gEn-13` (mixed case lower-upper-lower、case-sensitive guard) は match しない", () => {
        expect(matches("gEn-13")).toBe(false);
      });

      it("negative: `gEN-13` (mixed case lower-upper-upper、case-sensitive guard 完全性) は match しない", () => {
        expect(matches("gEN-13")).toBe(false);
      });
    });
  });

  // ─────────────── B-3g project-specific flag naming guard (forcing function) ───────────────
  // Codex pre-flight Track A finding 由来。`/harness-work --maintainer-mode` のような
  // project-specific flag naming は **R2 (内部識別子 leak) リスク高** のため、shipped spec
  // で検出して block する forcing function。代わりに既存 `work.taskTrackerMode = "handoff"`
  // config field の活用、もしくは generic flag (`--source plans|roadmap` 等) で受ける。
  // generic flag (`--source` / `--mode` / `--target` 等) や config field
  // (`taskTrackerMode`) は対象外 (negative case で固定)。
  describe("B-3g project-specific flag naming guard (positive / negative)", () => {
    const b3g = BLOCK_PATTERNS.find((p) => p.id === "B-3g");
    if (!b3g) {
      throw new Error("B-3g pattern is missing from BLOCK_PATTERNS");
    }
    const pat = b3g.pattern;
    const matches = (src: string): boolean => {
      pat.lastIndex = 0;
      return pat.test(src);
    };

    it("positive: `--maintainer-mode` (project-specific flag) は match する", () => {
      expect(matches("--maintainer-mode")).toBe(true);
    });

    it("positive: `--model-b-mode` (project-specific flag) は match する", () => {
      expect(matches("--model-b-mode")).toBe(true);
    });

    it("positive: `--parts-management-mode` (project-specific flag) は match する", () => {
      expect(matches("--parts-management-mode")).toBe(true);
    });

    it("positive: `--script-generate-mode` / `--new-partslist-mode` も match する", () => {
      expect(matches("--script-generate-mode")).toBe(true);
      expect(matches("--new-partslist-mode")).toBe(true);
    });

    it("negative: `--source` (generic flag) は match しない", () => {
      expect(matches("--source")).toBe(false);
    });

    it("negative: `--mode` / `--target` / `--scope` (generic prefix) は match しない", () => {
      expect(matches("--mode")).toBe(false);
      expect(matches("--target")).toBe(false);
      expect(matches("--scope")).toBe(false);
    });

    it("negative: `taskTrackerMode` (camelCase config field、flag ではない) は match しない", () => {
      expect(matches("taskTrackerMode")).toBe(false);
    });

    it("negative: `--maintainermode` (hyphen 不在) は match しない (`\\b` boundary)", () => {
      expect(matches("--maintainermode")).toBe(false);
    });
  });

  // ─────────────── B-3h numeric backlog tracker ID guard (forcing function) ───────────────
  // D-harness-work-parallel-mode-v2 (Phase A-2) で追加。test-bed handoff backlog の
  // `D-74` / `D-150` / `D-165` のような numeric tracker ID が shipped spec
  // (`commands/*.md` / `agents/*.md`) に転載されるのを CI で blocking する。
  // descriptive suffix (`D-handoff-check-lightweight`) は negative cases、
  // 単独の `D-` / `D-abc` も対象外。
  describe("B-3h numeric backlog tracker ID guard (positive / negative)", () => {
    const b3h = BLOCK_PATTERNS.find((p) => p.id === "B-3h");
    if (!b3h) {
      throw new Error("B-3h pattern is missing from BLOCK_PATTERNS");
    }
    const pat = b3h.pattern;
    const matches = (src: string): boolean => {
      pat.lastIndex = 0;
      return pat.test(src);
    };

    it("positive: `D-74` (numeric) は match する", () => {
      expect(matches("D-74")).toBe(true);
    });

    it("positive: `D-150` / `D-165` (3-digit) は match する", () => {
      expect(matches("D-150")).toBe(true);
      expect(matches("D-165")).toBe(true);
    });

    it("positive: 文中の `D-1` / `D-9999` (任意の桁数) は match する", () => {
      expect(matches("intro D-1 outro")).toBe(true);
      expect(matches("intro D-9999 outro")).toBe(true);
    });

    it("negative: `D-handoff-check-lightweight` (descriptive suffix) は match しない", () => {
      expect(matches("D-handoff-check-lightweight")).toBe(false);
    });

    it("negative: `D-harness-work-parallel-mode-v2` (descriptive ID) は match しない", () => {
      expect(matches("D-harness-work-parallel-mode-v2")).toBe(false);
    });

    it("negative: `D-` 単体 / `D-abc` (numeric 不在) は match しない", () => {
      expect(matches("D-")).toBe(false);
      expect(matches("D-abc")).toBe(false);
    });

    it("negative: `XD-74` (前置 word char で `\\b` 不成立) は match しない", () => {
      expect(matches("XD-74")).toBe(false);
    });

    it("negative: `D-74a` (後置 word char) は match しない (`\\b` boundary)", () => {
      expect(matches("D-74a")).toBe(false);
    });

    it("negative: `d-74` (小文字) は match しない (case-sensitive)", () => {
      expect(matches("d-74")).toBe(false);
    });

    // Codex Phase 7 minor 対応: lookbehind `(?<![\w-])` 強化で左境界を厳格化。
    // 旧 `\bD-\d+\b` は word/non-word 境界で成立するため hyphen-compound や
    // CJK-adjacent などを誤 match していた。
    it("negative: `25-D-37` (hyphen-compound、左に `-`) は match しない (lookbehind 強化)", () => {
      expect(matches("25-D-37")).toBe(false);
    });

    it("negative: `foo-D-12` (左 word + hyphen compound) は match しない", () => {
      expect(matches("foo-D-12")).toBe(false);
    });

    // CJK-adjacent caveat: JavaScript `\w` is ASCII only ([A-Za-z0-9_])
    // unless the `/u` flag + Unicode property escapes are used. The
    // lookbehind `(?<![\w-])` therefore does NOT exclude CJK adjacency
    // — `漢字D-37` still matches because `字` is not in `\w`. Documented
    // here as a known boundary; if CJK leaks become a real issue later,
    // upgrade the pattern to `/(?<![\p{L}\p{N}_-])D-\d+\b/gu` (Unicode-
    // aware) and re-pin this case as a negative.
    it("known boundary: CJK-adjacent `漢字D-37` STILL matches (ASCII `\\w` limitation)", () => {
      expect(matches("漢字D-37")).toBe(true);
    });

    it("positive (regression): 文頭 / whitespace 後の `D-74` は match する", () => {
      expect(matches("D-74")).toBe(true);
      expect(matches("note: D-74 was filed")).toBe(true);
      expect(matches("(D-74)")).toBe(true); // 括弧 = 非 word 非 hyphen
    });
  });
});

// ---------------------------------------------------------------------------
// codex-sync.md parallel dispatch cross-reference fixation
// ---------------------------------------------------------------------------
// Output File Redirect section と Mid-Response Truncation section を結ぶ
// cross-reference subsection を CI で固定する。複数 codex-sync agent を
// parallel dispatch した際の **parent subagent budget 累積** という別 symptom
// を、既に shipped 済の `[output-file: ...]` redirect 機能に誘導する役割。
// 将来の編集で subsection が削除 / orphan 化した場合に PR を blocking する。
describe("codex-sync.md parallel dispatch cross-reference fixation", () => {
  const specPath = resolve(PLUGIN_ROOT, "agents/codex-sync.md");
  const content = readFileSync(specPath, "utf8");
  const subsectionHeader = "### When parallel dispatch amplifies the risk";

  function extractSection(): string {
    const idx = content.indexOf(subsectionHeader);
    if (idx === -1) return "";
    // Terminate at the next `### ` (sibling subsection) OR `## ` (parent
    // section change), whichever comes first. Splitting only on `## ` would
    // accidentally include any future sibling `### ` added under the same
    // parent, expanding the zone-scoped check beyond the intended subsection.
    const start = idx + subsectionHeader.length;
    const candidates = [
      content.indexOf("\n### ", start),
      content.indexOf("\n## ", start),
    ].filter((n) => n !== -1);
    const next = candidates.length > 0 ? Math.min(...candidates) : -1;
    return content.slice(idx, next === -1 ? content.length : next);
  }

  it("subsection header が codex-sync.md に存在する (presence guard)", () => {
    expect(content).toContain(subsectionHeader);
  });

  it("既存 'Output File Redirect' parent section header が存在する (rename / removal を blocking)", () => {
    expect(content).toContain("## Output File Redirect (optional, prompt-driven)");
  });

  it("subsection が既存 Output File Redirect 機能への cross-reference を含む (orphan 化防止)", () => {
    const section = extractSection();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/output-file|Output File Redirect/i);
  });

  it("subsection が project-local leak / locale-specific / 具体数値を含まない (zone scan)", () => {
    const section = extractSection();
    expect(section.length).toBeGreaterThan(0);
    // R2 (project-specific identifiers) / R3 (generic placeholders).
    // gen-N pattern intentionally aligned with the project-wide B-3f
    // blocklist — `(?<![\w-])gen-\d+\b` is fixed by 4 negative regression
    // tests (gen-1.3 / regen-13 / case variants); broadening the pattern
    // would break those CI guards.
    expect(section).not.toMatch(/parts-management|new-partslist/);
    expect(section).not.toMatch(/(?<![\w-])gen-\d+\b/);
    expect(section).not.toMatch(/Phase\s+\d+|Round\s+\d+/);
    expect(section).not.toMatch(/\bD-\d+\b/);
    // R3 locale: 日本語 / CJK 文字混入なし (English-first shipped spec)
    expect(section).not.toMatch(/[　-〿぀-ゟ゠-ヿ一-鿿]/);
    // session-specific empirical 数値 leak guard — narrow to "<N> agents" / "<N> parallel"
    // (workers / children は legit 表現 e.g. "32-bit children" との衝突回避で除外)
    expect(section).not.toMatch(/\b\d+\+?\s*(agents?|parallel)\b/i);
  });
});
