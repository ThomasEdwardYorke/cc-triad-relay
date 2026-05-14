/* generality-exemption: B-1,B-2c,B-3h | HARNESS-test-self-reference | 2099-12-31 | detector self-reference unavoidable: this content test asserts that commands/harness-merge-train.md does NOT contain project-specific branch names or paths, so the leak strings appear here as test inputs (B-1, B-2c). Additionally B-3h is exempt because the v5 design-decisions ledger (D-74 / D-75 / D-76 / D-77) is referenced in the test as a fixture for cross-PR consistency assertions. CONTRIBUTING.md §3.1 exemption grammar (file-head form) per harness-plugin-dev.md R3 example. */

/**
 * core/src/__tests__/harness-merge-train-content.test.ts
 *
 * `/harness-merge-train` skill spec (commands/harness-merge-train.md) の
 * 構造的不変条件を CI 時点で固定する content test。
 *
 * 背景:
 *   prior review で `/harness-work` の review/merge orchestration spec gap が
 *   認識された (multi-PR squash merge を gh api 直叩きで代替 → consumer rules
 *   G3/G4/G5/G7 違反)。これに対して merge-routing 専用 skill を新設、複数 PR
 *   を Phase chain (M0-M9) で順次 squash merge する skill 経路を必須化する。
 *
 * 本 test は spec doc が merge-routing 仕様の不変条件を満たすことを保証する。
 *
 * 対応する harness rule:
 *   - consumer-side implementation-workflow rule の skill connectivity (G3-G8)
 *   - CONTRIBUTING.md §1.2 (internal tracker IDs leak 防止 = R2)
 *   - generality.test.ts blocklist (R3)
 *
 * 期待 (高水準):
 *   1. frontmatter (name / description / description-ja / allowed-tools / argument-hint)
 *   2. Phase chain M0-M9 が全て存在 + 各 phase の責務が明文化
 *   3. 各 phase の **skill 委譲先** (G4 codex-sync / G5 pseudo-coderabbit-loop /
 *      G6 coderabbit-review / G7 codex-team / G8 session-handoff) が明示、
 *      かつ Phase 見出し内に該当委譲先が同居 (false-positive 回避の 2 要件束ね)
 *   4. fail-fast 契約
 *   5. Skill connectivity 原則 (gh CLI 直叩き禁止) の明文化
 *   6. consumer-side discipline ledger 自動追記の言及
 *   7. R2 / R3 / R1 generic 例示値 (project-specific paths/IDs を使わない)
 *   8. spec doc は 1500 行以下 (skill discipline)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const SPEC_PATH = resolve(PLUGIN_ROOT, "commands", "harness-merge-train.md");

function readSpec(): string {
  return readFileSync(SPEC_PATH, "utf-8");
}

describe("/harness-merge-train spec (commands/harness-merge-train.md)", () => {
  const content = readSpec();

  // -----------------------------------------------------------------
  // 1. frontmatter 必須項目
  // -----------------------------------------------------------------
  describe("frontmatter", () => {
    it("name: harness-merge-train を持つ", () => {
      expect(content).toMatch(/^---[\s\S]*?\nname:\s*harness-merge-train/);
    });

    it("description (英語) を持つ", () => {
      expect(content).toMatch(/^---[\s\S]*?\ndescription:\s*"[^"]+"/);
    });

    it("description-ja (日本語) を持つ", () => {
      expect(content).toMatch(/^---[\s\S]*?\ndescription-ja:\s*"[^"]+"/);
    });

    it("allowed-tools 配列を持つ (Bash / Read / Edit / Skill / Agent / TaskCreate / Monitor 含む)", () => {
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Bash"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Read"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Edit"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Skill"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Agent"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"TaskCreate"[^\]]*\]/);
      expect(fm).toMatch(/allowed-tools:\s*\[[^\]]*"Monitor"[^\]]*\]/);
    });

    it("argument-hint が strict pipe-separated bracketed form (token-only、no spaces/ellipsis)", () => {
      // CodeRabbit が要求する `argument-hint: [word|word|...]` strict form。
      // token charset は `[A-Za-z0-9-]` のみ (空白 / ドット / ellipsis は禁止、純粋な
      // dash-separated identifier。詳細値 (jq syntax / profile allowlist 等) は
      // 本文 ## 入力仕様 section で扱う)。
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      expect(fm).toMatch(/^argument-hint:\s*"\[[A-Za-z0-9-]+(?:\|[A-Za-z0-9-]+)+\]"\s*$/m);
      // 主要 token (semantic check) — extract したものを set として比較。
      const hint = fm.match(/^argument-hint:\s*"([^"]*)"/m)?.[1] ?? "";
      const tokens = hint.replace(/^\[|\]$/g, "").split("|");
      expect(tokens).toEqual(
        expect.arrayContaining([
          "pr-number",
          "filter",
          "order",
          "dry-run",
          "profile",
          "max-iterations",
          "no-commit",
        ]),
      );
    });
  });

  // -----------------------------------------------------------------
  // 2. Phase chain M0-M9 が全て存在
  // -----------------------------------------------------------------
  describe("Phase chain M0-M9 全 phase 存在 + 責務明文化", () => {
    const phases = [
      { id: "M0", responsibilities: /pre-?flight|mergeable|CI\s*(?:state|状態)|Clear\s*判定|Step\s*7\.?4/i },
      { id: "M1", responsibilities: /rebase|conflict|fetch\s+origin/i },
      { id: "M2", responsibilities: /pre-?merge|G4|G5|codex-sync|pseudo-coderabbit-loop/i },
      { id: "M3", responsibilities: /push|--?force-with-lease/i },
      { id: "M4", responsibilities: /CI\s*wait|gh\s+pr\s+checks|Monitor/i },
      { id: "M5", responsibilities: /(?:Real\s*CR|CodeRabbit)\s*(?:Clear|review)|coderabbit-review|G6/i },
      { id: "M6", responsibilities: /codex-team|adversarial|G7|Phase\s*7/i },
      { id: "M7", responsibilities: /squash\s*merge|gh\s+pr\s+merge.*--squash/i },
      { id: "M8", responsibilities: /worktree\s*(?:cleanup|remove)|git\s+worktree\s+remove/i },
      { id: "M9", responsibilities: /handoff|session-handoff|G8|update.*archive|archive.*update/i },
    ];

    for (const { id, responsibilities } of phases) {
      it(`Phase ${id} が宣言され責務が明示される`, () => {
        // Phase header (`### M1 — ...` 等の見出し) を全件走査し、
        // 当該 header 配下の section (次の `### ` または `## ` ヘッダまで) に
        // 責務 keyword が含まれることを確認 (header の 800 字内固定だと
        // 同じ ID が他 section で参照された際の偽陽性 / 偽陰性に弱い)。
        const headerRe = new RegExp(`^#{2,4}\\s*${id}\\b`, "gm");
        const matches = [...content.matchAll(headerRe)];
        expect(matches.length).toBeGreaterThan(0);
        const sections = matches.map((m) => extractSection(content, m.index ?? 0));
        const found = sections.some((sec) => responsibilities.test(sec));
        expect(found, `Phase ${id} sections did not contain responsibilities pattern`).toBe(true);
      });
    }
  });

  // -----------------------------------------------------------------
  // 3. Skill 委譲先 (G4-G8) の明示
  // -----------------------------------------------------------------
  describe("各 phase の skill 委譲先が明示される (consumer rules G4-G8、Phase + 委譲先の 2 要件束ね)", () => {
    // 2 要件束ね: 単純な単語一致だけだと別 section に偶然出現で false-positive。
    // 各 G ラベルが対応する Phase 見出し配下 section 内で **同居** することを要求。
    // helper extractSection(content, idx) は file 末尾で定義、idx 始点から次の
    // 同 level または上位 level 見出しまでを切り出す。

    it("G4: M2 section に harness:codex-sync agent 委譲 + G4 ラベル同居", () => {
      const m2Idx = content.search(/^#{2,4}\s*M2\b/m);
      expect(m2Idx).toBeGreaterThanOrEqual(0);
      const m2 = extractSection(content, m2Idx);
      expect(m2).toMatch(/G4/i);
      expect(m2).toMatch(/harness:codex-sync|codex-sync/);
    });

    it("G5: M2 section に /pseudo-coderabbit-loop --local + G5 ラベル同居", () => {
      const m2Idx = content.search(/^#{2,4}\s*M2\b/m);
      expect(m2Idx).toBeGreaterThanOrEqual(0);
      const m2 = extractSection(content, m2Idx);
      expect(m2).toMatch(/G5/i);
      expect(m2).toMatch(/pseudo-coderabbit-loop[\s\S]{0,80}?--local/);
    });

    it("G6: M5 section に /coderabbit-review + G6 ラベル同居", () => {
      const m5Idx = content.search(/^#{2,4}\s*M5\b/m);
      expect(m5Idx).toBeGreaterThanOrEqual(0);
      const m5 = extractSection(content, m5Idx);
      expect(m5).toMatch(/G6/i);
      expect(m5).toMatch(/coderabbit-review/);
    });

    it("G7: M6 section に /codex-team adversarial + G7 ラベル同居", () => {
      const m6Idx = content.search(/^#{2,4}\s*M6\b/m);
      expect(m6Idx).toBeGreaterThanOrEqual(0);
      const m6 = extractSection(content, m6Idx);
      expect(m6).toMatch(/G7/i);
      expect(m6).toMatch(/codex-team[\s\S]{0,80}?adversarial/i);
    });

    it("G8: M9 section に /session-handoff (update|archive) + G8 ラベル同居", () => {
      const m9Idx = content.search(/^#{2,4}\s*M9\b/m);
      expect(m9Idx).toBeGreaterThanOrEqual(0);
      const m9 = extractSection(content, m9Idx);
      expect(m9).toMatch(/G8/i);
      expect(m9).toMatch(/session-handoff[\s\S]{0,200}?(?:update|archive)/);
    });

    it("Loop exit: 全 PR 完了後の archive 委譲が明示 (G8 補強)", () => {
      // M9 単発の handoff update に加えて、loop exit ritual で session 単位 archive
      // が宣言されていること (D-77 不変条件 #2 補強)。
      expect(content).toMatch(/Loop\s*exit[\s\S]{0,400}?session-handoff[\s\S]{0,80}?archive/i);
    });
  });

  // -----------------------------------------------------------------
  // 4. Clear 判定 3 段マトリクス参照 (M5)
  // -----------------------------------------------------------------
  describe("Clear 判定 (M5) は coderabbit-review Step 7.4 マトリクス準拠", () => {
    it("APPROVED / unresolved=0 / blocker 不在 の 3 シグナルに言及", () => {
      expect(content).toMatch(/APPROVED/);
      expect(content).toMatch(/unresolved/);
      expect(content).toMatch(/(?:rate-?limit|paused|blocker)/i);
    });
  });

  // -----------------------------------------------------------------
  // 4.5. Dynamic overlap recheck (M6.5)
  // -----------------------------------------------------------------
  describe("Dynamic overlap recheck (M6.5)", () => {
    it("M6 後 / M7 前に dynamic overlap recheck phase が存在する", () => {
      const m6Idx = content.search(/^#{2,4}\s*M6\b/m);
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      const m7Idx = content.search(/^#{2,4}\s*M7\b/m);

      expect(m6Idx).toBeGreaterThanOrEqual(0);
      expect(recheckIdx).toBeGreaterThan(m6Idx);
      expect(m7Idx).toBeGreaterThan(recheckIdx);
      expect(extractSection(content, recheckIdx)).toMatch(
        /Dynamic\s+overlap\s+recheck|動的\s*overlap/i,
      );
    });

    it("merge-base aware changed-path collection を明示する", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/git\s+-C\s+"\$WORKTREE_DIR"\s+merge-base/);
      expect(section).toMatch(
        /git\s+-C\s+"\$repo_dir"\s+-c\s+core\.quotePath=false\s+diff\s+--name-only\s+--no-renames/,
      );
      expect(section).toMatch(
        /write_dynamic_changed_files\s+"\$WORKTREE_DIR"\s+"\$CURRENT_BASE"\s+"\$CURRENT_HEAD_REF"/,
      );
      expect(section).toMatch(/BASE_REF="refs\/remotes\/origin\/\$\{BASE_BRANCH\}"/);
      expect(section).toMatch(/CURRENT_HEAD_REF="refs\/remotes\/origin\/\$\{HEAD_BRANCH\}"/);
      expect(section).toMatch(/fetch_dynamic_overlap_ref\(\)/);
      expect(section).toContain(
        'git -C "$REPO_ROOT" fetch origin "+refs/heads/${branch}:${destination_ref}"',
      );
      expect(section).toContain('fetch_dynamic_overlap_ref "$BASE_BRANCH" "$BASE_REF"');
      expect(section).toContain(
        'fetch_dynamic_overlap_ref "$HEAD_BRANCH" "$CURRENT_HEAD_REF"',
      );
      expect(section).toContain(
        'fetch_dynamic_overlap_ref "$OTHER_HEAD_BRANCH" "$OTHER_HEAD_REF"',
      );
      expect(section).toMatch(/\$CURRENT_HEAD_REF/);
      expect(section).toMatch(/\$BASE_REF/);
    });

    it("current PR の diff は PR worktree と最新 remote head に固定し、coordinator HEAD を使わない", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/WORKTREE_DIR=[\s\S]{0,240}?worktree\s+list\s+--porcelain/);
      expect(section).toMatch(/git\s+-C\s+"\$WORKTREE_DIR"[\s\S]{0,180}?\$CURRENT_HEAD_REF/);
      expect(section).toMatch(/refs\/remotes\/origin\/\$\{HEAD_BRANCH\}/);
      expect(section).toMatch(/stale\s+local\s+`HEAD`/);
      expect(section).toMatch(/coordinator\s+checkout[\s\S]{0,120}?HEAD/i);
    });

    it("narrow checkout でも remote-tracking ref が更新される explicit refspec を使う", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/explicit\s+destination\s+refspec/);
      expect(section).toMatch(/\+refs\/heads\/<branch>:refs\/remotes\/origin\/<branch>/);
      expect(section).toMatch(/Narrow\s+\/\s+single-branch\s+checkout/i);
      expect(section).toMatch(/FETCH_HEAD/);
    });

    it("ref refresh / merge-base / diff collection 失敗時は stale data を使わず fail-fast する", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/if\s+!\s+git\s+-C\s+"\$REPO_ROOT"\s+fetch\s+origin/);
      expect(section).toMatch(/if\s+!\s+CURRENT_BASE=\$\(git\s+-C\s+"\$WORKTREE_DIR"\s+merge-base/);
      expect(section).toMatch(/if\s+!\s+OTHER_BASE=\$\(git\s+-C\s+"\$REPO_ROOT"\s+merge-base/);
      expect(section).toMatch(
        /if\s+!\s+git\s+-C\s+"\$repo_dir"[\s\S]{0,120}?>\s+"\$output_file";\s+then/,
      );
      expect(section).toMatch(/stale\s+local\s+ref|empty\s+changed\s+path\s+list/);
      expect(section).toMatch(/do\s+not\s+continue\s+to\s+M7/i);
    });

    it("changed path list は TMPDIR fallback 付きの専用 temp dir に書く", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/mktemp\s+-d\s+"\$\{TMPDIR:-\/tmp\}\/merge-train-overlap-\$PR\.XXXXXX"/);
      expect(section).toMatch(/if\s+!\s+DYNAMIC_OVERLAP_TMP="\$\(mktemp\s+-d/);
      expect(section).toMatch(/\[\s+-z\s+"\$DYNAMIC_OVERLAP_TMP"\s+\]/);
      expect(section).toMatch(/Failed to create temp dir for dynamic overlap recheck[\s\S]{0,120}TMPDIR=/);
      expect(section).toMatch(/PR=\$PR/);
      expect(section).toMatch(/cleanup_dynamic_overlap_tmp\(\)/);
      expect(section).toMatch(/rm\s+-rf\s+"\$DYNAMIC_OVERLAP_TMP"/);
      expect(section).toMatch(/trap\s+cleanup_dynamic_overlap_tmp\s+EXIT/);
      expect(section).toMatch(/\$DYNAMIC_OVERLAP_TMP\/current-changed-files/);
      expect(section).toMatch(/\$DYNAMIC_OVERLAP_TMP\/remaining-changed-files-<safe-slug>/);
    });

    it("changed path list は quotePath を無効化して escaped path output を避ける", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      const quotePathMentions = section.match(/core\.quotePath=false/g) ?? [];
      expect(quotePathMentions.length).toBeGreaterThanOrEqual(2);
      expect(section).toMatch(/escaped\/quoted\s+path\s+output/);
      expect(section).toMatch(/repository-relative\s+POSIX\s+path\s+validation/);
    });

    it("rename source path を落とさないため --no-renames の理由を明示する", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/--no-renames/);
      expect(section).toMatch(/rename[\s\S]{0,160}?source\s+path|source\s+path[\s\S]{0,160}?rename/i);
    });

    it("overlap は blocking result として conflicting paths + remaining PR/worktree identifiers を返す", () => {
      const recheckIdx = content.search(/^#{2,4}\s*M6\.5\b/m);
      expect(recheckIdx).toBeGreaterThanOrEqual(0);
      const section = extractSection(content, recheckIdx);

      expect(section).toMatch(/detectDynamicChangedPathOverlap/);
      expect(section).toMatch(/@cc-triad-relay\/core\/dist\/work\/worktree-overlap\.js/);
      expect(section).toMatch(/conflicting\s+paths|overlappingFiles|競合.*path/i);
      expect(section).toMatch(/remaining\s+(?:PR|worktree)|残(?:り|存).*PR/i);
      expect(section).toMatch(/blocking|fail-?fast/i);
    });
  });

  // -----------------------------------------------------------------
  // 5. fail-fast 契約
  // -----------------------------------------------------------------
  describe("fail-fast 契約", () => {
    it("fail-fast の文言を含む", () => {
      expect(content).toMatch(/fail-?fast/i);
    });

    it("失敗時に残 PR を touch せず user に判断委譲する旨を明示", () => {
      expect(content).toMatch(
        /(?:残\s*PR.*touch\s*せず|stop|halt|残り(?:の|を).*touch|stop\s+the\s+train|abort\s+the\s+train)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 6. Skill connectivity 原則
  // -----------------------------------------------------------------
  describe("Skill connectivity 原則 (D-76 共通)", () => {
    it("「全タスクは skill 経由」の原則が明文化される", () => {
      expect(content).toMatch(
        /(?:全タスク.*skill\s*経由|skill\s+connectivity|skill[\s-]+via\s+invocation|skill\s+を\s*経由|skill[\s\S]{0,40}?(?:必須|MUST))/i,
      );
    });

    it("直接 gh CLI 直叩き / 手動 rebase の禁止が明示", () => {
      expect(content).toMatch(
        /(?:直接\s*gh|gh\s*CLI\s*直叩き|手動\s*rebase|manual\s+rebase|構造規律違反|disciplinary\s+violation)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 7. 鉄則 7 ledger 自動追記
  // -----------------------------------------------------------------
  describe("鉄則 7 ledger 連携", () => {
    it("規律違反検出時に ledger 自動追記する旨を明示", () => {
      expect(content).toMatch(
        /(?:鉄則\s*7|implementation-workflow\.md|ledger)[\s\S]{0,200}?(?:自動\s*追記|append-?only|auto-?append)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 8. 入力仕様 (positional + flags)
  // -----------------------------------------------------------------
  describe("入力仕様", () => {
    it("複数 PR 番号を positional で受ける (placeholder 表記のみ許容)", () => {
      // R3 generality: spec doc には生 PR 番号 literal を書かない、必ず
      // <pr-a> <pr-b> ... 等の placeholder を使う。test 自体も regex で
      // bare digit literal を許容する pattern (`\d+\s+\d+\s+\d+` 等) を使わない。
      expect(content).toMatch(/PR[\s\S]{0,80}?番号|PR\s*number/);
      expect(content).toMatch(/(?:複数|multiple|positional|<pr-[a-z]+>\s+<pr-[a-z]+>|<pr-?(?:number|id)?>)/i);
    });

    it("spec body に生 PR 番号 literal が含まれていない (R3 generality、複合 pattern)", () => {
      // R3 generality: spec body に生 PR 番号 literal を一切含めない。
      // 検出パターンは複合: 連続数字 / `#N` / `PR #N` / コマンド例 `/harness-merge-train N`。
      // time/duration の単独数字 (例 `30 分`, `60-90 min`) は意図的に対象外
      // (range 表記の hyphen 区切り / 単位接尾) — その場合 PR 番号文脈ではないため安全。
      const violationPatterns: Array<{ id: string; re: RegExp }> = [
        // (a) 連続する 2-5 個の数字 token (空白 / カンマ区切り、dash 区切りは除外)
        { id: "consecutive-digits", re: /(?<![<>\w-])\d{1,4}(?:[\s,]+\d{1,4}){1,4}(?![\w/.-])/g },
        // (b) markdown table cell 形式: `| #N |` (PR 番号として表現)
        { id: "table-pr-cell", re: /\|\s*#\d{1,5}\s*\|/g },
        // (c) `PR #N` のような prose 中言及
        { id: "pr-prose-ref", re: /\bPR\s*#\d{1,5}\b/g },
        // (d) 命令文中の `/harness-merge-train N` `/harness-merge-train #N`
        { id: "command-pr-arg", re: /\/harness-merge-train(?:\s+#?\d{1,5})+/g },
        // (e) commit SHA-like literal (7-40 hex chars in merge result table 等)
        { id: "commit-sha", re: /merged:\s*[0-9a-f]{7,40}\b/gi },
      ];
      const violations = violationPatterns.flatMap(({ id, re }) => {
        const hits = content.match(re) ?? [];
        return hits.map((hit) => `[${id}] ${hit}`);
      });
      expect(violations, `Raw PR-number/SHA literals in spec: ${JSON.stringify(violations)}`).toEqual([]);
    });

    it("--filter で gh pr list 経由フィルタ可能", () => {
      expect(content).toMatch(/--filter[\s\S]{0,200}?gh\s+pr\s+list/);
    });

    it("--order で merge 順序を明示できる", () => {
      expect(content).toMatch(/--order/);
    });

    it("--dry-run で plan 表示のみ可能", () => {
      expect(content).toMatch(/--dry-run[\s\S]{0,200}?(?:plan|表示|preview)/i);
    });

    it("--profile で CodeRabbit profile 伝播 (chill/assertive/strict)", () => {
      expect(content).toMatch(/--profile[\s\S]{0,200}?(?:chill|assertive|strict)/i);
    });
  });

  // -----------------------------------------------------------------
  // 9. R2 / R3 / R1 generic 例示値 (harness-plugin-dev 規約)
  // -----------------------------------------------------------------
  describe("Generic 例示値の徹底 (harness-plugin-dev R1/R2/R3)", () => {
    it("project-specific branch 名 (feature/new-partslist) を含まない", () => {
      // generality-exemption に該当しない通常記述では使えない
      // (本 spec doc は generic、generality-exemption 不要)
      expect(content).not.toMatch(/feature\/new-partslist/);
    });

    it("project-specific path (.docs/plan/ 等の前身プロジェクト遺物) を含まない", () => {
      expect(content).not.toMatch(/protected-data/);
      expect(content).not.toMatch(/\.docs\/plan\//);
    });

    it("内部 tracker ID (Phase N 申送 / Round N / A-\\d+) を含まない", () => {
      // R2 (CONTRIBUTING.md §1.2): shipped spec に内部 tracker ID は禁止
      // 例外: D-74 / D-75 / D-76 は design-decisions の generic 識別子として確立済
      // (consumer-side handoff 用の semantic ID。harness plugin core 設計判断 ID として
      // 引用されることは許容範囲、blocked patterns には該当しない)
      expect(content).not.toMatch(/Phase\s+\d+\s*申送/);
      expect(content).not.toMatch(/Round\s+\d+/);
      expect(content).not.toMatch(/\bA-\d+\s*r\d+\b/);
    });
  });

  // -----------------------------------------------------------------
  // 9.5. Skill 不在 fallback section (緊急避難経路)
  // -----------------------------------------------------------------
  describe("Skill 不在 fallback section (緊急避難経路)", () => {
    function getFallbackSection(): string {
      const idx = content.search(/^##\s*Skill\s*不在\s*fallback/m);
      expect(idx).toBeGreaterThanOrEqual(0);
      return extractSection(content, idx);
    }

    it("「Skill 不在 fallback」section heading が存在する", () => {
      expect(content).toMatch(/##\s*Skill\s*不在\s*fallback/);
    });

    it("発動条件が明示される (plugin 老朽化 / typeahead 未出現 / runtime error / mid-phase error)", () => {
      const section = getFallbackSection();
      expect(section).toMatch(/(?:発動条件|発動契機)/);
      expect(section).toMatch(/(?:plugin\s*install\s*老朽化|typeahead.*出現しない|typeahead.*未出現|runtime\s*error)/i);
    });

    it("--force-with-lease=<branch>:<expected-sha> 記法が literal で記載", () => {
      // branch + expected SHA 併記の規約 (前 session で stale info reject 失敗事象あり)
      const section = getFallbackSection();
      expect(section).toMatch(/--force-with-lease=\S+:\S+/);
    });

    it("Discipline ledger 自動追記が mandatory であることが明示", () => {
      const section = getFallbackSection();
      expect(section).toMatch(/ledger[\s\S]{0,400}?(?:mandatory|必須|skip\s*不可|隠蔽)/i);
      expect(section).toMatch(/node[\s\S]{0,200}?ledger-cli\.js/);
    });

    it("plugin reload 復旧手順が含まれる (claude restart → typeahead 確認)", () => {
      const section = getFallbackSection();
      expect(section).toMatch(/(?:claude\s*(?:restart|exit|プロセス再起動))/i);
      expect(section).toMatch(/typeahead/);
    });

    it("--no-skill-fallback flag との区別が明示される", () => {
      const section = getFallbackSection();
      expect(section).toMatch(/--no-skill-fallback/);
      expect(section).toMatch(/(?:区別|区分|逆|distinct|different)/i);
    });

    it("fallback section は generic 例示値のみ (R3 generality)", () => {
      const section = getFallbackSection();
      expect(section).not.toMatch(/feature\/new-partslist/);
      expect(section).toMatch(/<branch-[a-z]+>|<pr-[a-z]+>|<repo>/);
    });

    it("Step 1 — Step 8 の手順が numbered で全揃い", () => {
      const section = getFallbackSection();
      for (let i = 1; i <= 8; i++) {
        expect(section).toMatch(
          new RegExp(`####\\s+Step\\s+${i}\\b|Step\\s+${i}\\s*[:：]`, "i"),
        );
      }
    });

    it("rebase strategy 切替 (squash strategy 切替) への言及がある", () => {
      const section = getFallbackSection();
      expect(section).toMatch(/(?:squash\s*strategy|rebase\s*strategy)\s*切替/i);
    });
  });

  // -----------------------------------------------------------------
  // 10. 全体不変条件 (spec discipline)
  // -----------------------------------------------------------------
  describe("spec discipline 不変条件", () => {
    it("spec doc は 1500 行以下 (skill discipline、長すぎる spec は分割)", () => {
      const lineCount = content.split(/\r?\n/).length;
      expect(lineCount).toBeLessThanOrEqual(1500);
    });

    it("/harness-work v5 merge route との連携 (D-76 cross-reference)", () => {
      expect(content).toMatch(/harness-work[\s\S]{0,200}?(?:v5|merge\s*mode|merge\s*route)/i);
    });

    it("関連スキル table を持つ (caller / 委譲先一覧)", () => {
      expect(content).toMatch(/関連\s*スキル|Related\s+skills?/i);
    });
  });
});

/**
 * Markdown header 始点 idx から、次の `## ` / `### ` / `#### ` 見出しまでの section を抽出する。
 * Phase header の責務 section を厳密に切り出すため、後続の `## ` (level-2) を見たら
 * その時点で section 終端とする (Phase chain 全体を 1 ブロックで包んでいる場合に対応)。
 *
 * 重要: fenced code block (` ``` ... ``` `) 内側の `# bash comment` を markdown heading と
 * 誤検知しないよう、code block 状態を tracking する。
 */
function extractSection(content: string, startIdx: number): string {
  const lines = content.slice(startIdx).split(/\r?\n/);
  if (lines.length === 0) return "";
  const headerMatch = lines[0]!.match(/^(#{2,4})\s/);
  if (!headerMatch) return lines.join("\n");
  const startLevel = headerMatch[1]!.length;
  const out: string[] = [lines[0]!];
  let inCodeBlock = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // fenced code block の開始 / 終了 (``` で始まる行)
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    // code block 外でのみ markdown heading 判定
    if (!inCodeBlock) {
      const m = line.match(/^(#{1,4})\s/);
      if (m && m[1]!.length <= startLevel) break;
    }
    out.push(line);
  }
  return out.join("\n");
}
