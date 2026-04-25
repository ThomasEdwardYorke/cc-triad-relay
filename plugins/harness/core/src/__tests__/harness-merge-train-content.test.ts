/* generality-exemption: B-1,B-2c | HARNESS-test-self-reference | 2026-Q4 | detector self-reference unavoidable: this content test asserts that commands/harness-merge-train.md does NOT contain project-specific branch names or paths, so the leak strings appear here as test inputs. CONTRIBUTING.md §3.1 exemption grammar (file-head form) per harness-plugin-dev.md R3 example. */

/**
 * core/src/__tests__/harness-merge-train-content.test.ts
 *
 * `/harness-merge-train` skill spec (commands/harness-merge-train.md) の
 * 構造的不変条件を CI 時点で固定する content test。
 *
 * 背景:
 *   gen-9 D-74 で `/harness-work` v4 の review/merge orchestration spec gap が
 *   発覚 (5 PR squash merge を gh api 直叩きで代替 → 鉄則 7 G3/G4/G5/G7 違反)。
 *   D-75 で本 skill を新設、複数 PR を Phase chain (M0-M9) で順次 squash merge
 *   する skill 経路を必須化する。
 *
 * 本 test は spec doc が D-75 で定義された不変条件を満たすことを保証する。
 *
 * 対応する harness rule:
 *   - .claude/rules/implementation-workflow.md 鉄則 7 G3-G8 (skill connectivity)
 *   - CONTRIBUTING.md §1.2 (internal tracker IDs leak 防止 = R2)
 *   - generality.test.ts blocklist (R3)
 *
 * 期待 (高水準):
 *   1. frontmatter (name / description / description-ja / allowed-tools / argument-hint)
 *   2. Phase chain M0-M9 が全て存在 + 各 phase の責務が明文化
 *   3. 各 phase の **skill 委譲先** (G4 codex-sync / G5 pseudo-coderabbit-loop /
 *      G6 coderabbit-review / G7 codex-team / G8 session-handoff) が明示
 *   4. fail-fast 契約
 *   5. Skill connectivity 原則 (gh CLI 直叩き禁止) の明文化
 *   6. 鉄則 7 ledger 自動追記の言及
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

    it("argument-hint が strict pipe-separated bracketed form (CR consistency)", () => {
      // CodeRabbit が要求する `argument-hint: [word|word|...]` strict form。
      // pseudo-coderabbit-loop.md と同等の token-only style。詳細値 (jq syntax /
      // profile allowlist 等) は本文 ## 入力仕様 section で扱う。
      expect(content).toMatch(/^argument-hint:\s*"\[[A-Za-z0-9._\- ]+(?:\|[A-Za-z0-9._\- ]+)+\]"\s*$/m);
      // 主要 token がすべて含まれていること (semantic check)
      const fm = content.match(/^argument-hint:\s*"([^"]*)"/m)?.[1] ?? "";
      expect(fm).toMatch(/PR/);
      expect(fm).toMatch(/filter/);
      expect(fm).toMatch(/order/);
      expect(fm).toMatch(/dry-run/);
      expect(fm).toMatch(/profile/);
      expect(fm).toMatch(/max-iterations/);
      expect(fm).toMatch(/no-commit/);
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
  describe("各 phase の skill 委譲先が明示される (鉄則 7 G4-G8)", () => {
    it("G4: harness:codex-sync agent への委譲が明示", () => {
      expect(content).toMatch(/harness:codex-sync|codex-sync/);
    });

    it("G5: /pseudo-coderabbit-loop --local の呼出が明示", () => {
      expect(content).toMatch(/pseudo-coderabbit-loop[\s\S]{0,80}?--local/);
    });

    it("G6: /coderabbit-review への委譲が明示", () => {
      expect(content).toMatch(/coderabbit-review/);
    });

    it("G7: /codex-team adversarial への委譲が明示", () => {
      expect(content).toMatch(/codex-team[\s\S]{0,80}?adversarial/i);
    });

    it("G8: /session-handoff (update / archive) への委譲が明示", () => {
      expect(content).toMatch(/session-handoff[\s\S]{0,200}?(?:update|archive)/);
      expect(content).toMatch(/session-handoff[\s\S]{0,400}?archive/);
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
    it("複数 PR 番号を positional で受ける", () => {
      expect(content).toMatch(/PR[\s\S]{0,80}?番号|PR\s*number/);
      expect(content).toMatch(/(?:複数|multiple|N\+|\d+\s+\d+\s+\d+|`30 31 32 33 34`|positional)/);
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
      // 例外: D-74 / D-75 / D-76 は design-decisions の generic 識別子として gen-9 で確立済
      // (consumer-side handoff 用の semantic ID。harness plugin core 設計判断 ID として
      // 引用されることは許容範囲、blocked patterns には該当しない)
      expect(content).not.toMatch(/Phase\s+\d+\s*申送/);
      expect(content).not.toMatch(/Round\s+\d+/);
      expect(content).not.toMatch(/\bA-\d+\s*r\d+\b/);
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
 */
function extractSection(content: string, startIdx: number): string {
  const lines = content.slice(startIdx).split(/\r?\n/);
  if (lines.length === 0) return "";
  const headerMatch = lines[0]!.match(/^(#{2,4})\s/);
  if (!headerMatch) return lines.join("\n");
  const startLevel = headerMatch[1]!.length;
  const out: string[] = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,4})\s/);
    if (m && m[1]!.length <= startLevel) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}
