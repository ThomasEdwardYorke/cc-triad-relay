/**
 * core/src/__tests__/harness-work-v5-merge.test.ts
 *
 * `/harness-work` v5 改訂 (D-76: merge mode 追加 + Skill connectivity 原則固定)
 * を CI 時点で固定する content test。
 *
 * 背景:
 *   gen-9 D-74 で v4 dispatcher が review/merge orchestration をスコープ外に
 *   していた spec gap が発覚。D-76 で v5 に bump し Step 2 モード判定に
 *   `merge` mode を追加、`/harness-merge-train` (D-75) への委譲経路を spec に
 *   明記する。
 *
 * 期待 (高水準):
 *   1. frontmatter description / description-ja に v5 と merge mode の言及
 *   2. Step 2 モード判定 logic に `merge` mode の case がある
 *   3. `detect_merge_orchestration()` シグナル定義が存在
 *   4. Step 4 委譲表 (mode → 委譲先) に merge mode 行がある
 *   5. Skill connectivity 原則 box が明文化
 *   6. v5 update history が末尾に追加
 *   7. v4 互換性が破壊されていない (既存 mode: solo/parallel/breezing/sequential 維持)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const SPEC_PATH = resolve(PLUGIN_ROOT, "commands", "harness-work.md");

function readSpec(): string {
  return readFileSync(SPEC_PATH, "utf-8");
}

describe("/harness-work v5 merge mode (commands/harness-work.md)", () => {
  const content = readSpec();

  // -----------------------------------------------------------------
  // 1. frontmatter v5 言及
  // -----------------------------------------------------------------
  describe("frontmatter description で v5 / merge mode を宣言", () => {
    it("description に v5 と merge mode の組合せ言及", () => {
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      // description / description-ja のいずれかで OK (両方が望ましいが)
      expect(fm).toMatch(/v5/);
      expect(fm).toMatch(/merge/i);
    });

    it("argument-hint に merge token を含む (strict pipe form)", () => {
      // CR consistency: argument-hint は strict bracketed pipe form
      // (`pseudo-coderabbit-loop.md` 同等)。merge token がそこに含まれること。
      expect(content).toMatch(/^argument-hint:\s*"\[[^"]*\bmerge\b[^"]*\]"\s*$/m);
    });
  });

  // -----------------------------------------------------------------
  // 2. Step 2 モード判定 logic に merge mode が登場
  // -----------------------------------------------------------------
  describe("Step 2 モード判定 logic", () => {
    it("merge mode が mode 一覧に登場", () => {
      // Step 2 周辺で `mode = "merge"` のような記述
      expect(content).toMatch(/mode\s*=\s*["']merge["']|"merge"|`merge`/);
    });

    it("detect_merge_orchestration() シグナル関数が定義される", () => {
      expect(content).toMatch(/detect_merge_orchestration\s*\(/);
    });

    it("シグナル: 引数 PR 番号 ≥ 2 / handoff backlog merge keyword / open PR ≥ 2 / --merge flag", () => {
      // 4 シグナルすべて言及されること
      expect(content).toMatch(/PR\s*番号.*(?:≥|>=|複数|2\s*件以上|≥\s*2)|PR\s*number[\s\S]{0,80}?(?:>=|≥|2\s*or\s*more)/i);
      expect(content).toMatch(/(?:handoff\s*backlog|backlog).*(?:merge\s*keyword|merge\s*orchestration|Top\s*Priority.*merge)/i);
      expect(content).toMatch(/gh\s+pr\s+list[\s\S]{0,200}?(?:open|state=open)[\s\S]{0,80}?(?:2|複数)/i);
      expect(content).toMatch(/--merge\s+flag|`--merge`/);
    });
  });

  // -----------------------------------------------------------------
  // 3. Step 4 委譲表に merge mode 行がある
  // -----------------------------------------------------------------
  describe("Step 4 委譲表に merge → /harness-merge-train が追加", () => {
    it("merge mode 行が委譲先 /harness-merge-train を指す", () => {
      // table 形式で merge | /harness-merge-train が並ぶか、
      // bullet 形式で `mode == "merge" → /harness-merge-train` が書かれる
      expect(content).toMatch(/merge[\s\S]{0,200}?\/harness-merge-train|harness-merge-train[\s\S]{0,200}?merge\s*mode/);
    });

    it("merge mode 委譲時に PROFILE materialize の責務が継承される", () => {
      // Step 4.1 / 4.2 と同じ "実値に materialize" 規約
      expect(content).toMatch(/(?:merge[\s\S]{0,300}?(?:materialize|実値|PROFILE)|PROFILE[\s\S]{0,300}?merge)/i);
    });
  });

  // -----------------------------------------------------------------
  // 4. Skill connectivity 原則 box
  // -----------------------------------------------------------------
  describe("Skill connectivity 原則 (D-76)", () => {
    it("「全タスクは skill 経由」原則 box が文書内に存在", () => {
      expect(content).toMatch(
        /(?:全タスクは\s*skill\s*経由|skill\s+connectivity\s+原則|skill\s+connectivity\s+principle|skill\s*経由\s*で\s*実行)/i,
      );
    });

    it("merge orchestration 専用経路が /harness-merge-train であることを宣言", () => {
      expect(content).toMatch(
        /merge\s+orchestration[\s\S]{0,400}?\/harness-merge-train|\/harness-merge-train[\s\S]{0,400}?merge\s+orchestration/i,
      );
    });

    it("直接 Bash / gh CLI 直叩き運用が構造規律違反である旨を明示", () => {
      expect(content).toMatch(
        /(?:直接\s*Bash|gh\s+CLI\s+直叩き|構造規律違反|手動\s+rebase|disciplinary\s+violation|skill\s*bypass)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 5. v5 update history
  // -----------------------------------------------------------------
  describe("更新履歴に v5 行が追加", () => {
    it("「v5」の更新履歴 entry が末尾近辺に存在", () => {
      // スキル更新履歴 section 内、bullet "- **v5"
      expect(content).toMatch(/-\s*\*\*v5[^\n]+/);
    });

    it("v5 entry が D-74 / D-75 / D-76 のいずれかに reference する", () => {
      const v5Entry = content.match(/-\s*\*\*v5[\s\S]*?(?=\n-\s*\*\*v\d|\n##|$)/);
      expect(v5Entry).not.toBeNull();
      const body = v5Entry?.[0] ?? "";
      expect(body).toMatch(/D-74|D-75|D-76|spec\s+gap|merge\s+mode|merge\s+orchestration|harness-merge-train/);
    });
  });

  // -----------------------------------------------------------------
  // 6. v4 互換性 (既存 mode が壊れていない)
  // -----------------------------------------------------------------
  describe("v4 互換性 (既存 mode 維持)", () => {
    const v4Modes = ["solo", "parallel", "breezing", "sequential", "dry-run"];
    for (const mode of v4Modes) {
      it(`既存 mode "${mode}" の言及が残っている`, () => {
        const escapedMode = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:mode\\s*=\\s*["']${escapedMode}["']|"${escapedMode}"|\`${escapedMode}\`)`);
        expect(content).toMatch(re);
      });
    }

    it("Auto Mode Detection の 件数ベース判定 (1 / 2-3 / 4+) が残っている", () => {
      expect(content).toMatch(/n_tasks\s*==\s*1|タスク数.*1\s*件|1\s*件.*solo/i);
      expect(content).toMatch(/n_tasks\s*<=?\s*3|2-3\s*件|2\s*〜\s*3\s*件|2\s*to\s*3/i);
      expect(content).toMatch(/n_tasks\s*>?=?\s*4|4\s*件\s*以上|4\s*\+|4\s*or\s*more/i);
    });
  });

  // -----------------------------------------------------------------
  // 7. /harness-merge-train cross-reference
  // -----------------------------------------------------------------
  describe("/harness-merge-train cross-reference", () => {
    it("関連スキル table に /harness-merge-train が並ぶ", () => {
      // 関連スキル section 内に harness-merge-train 行がある
      expect(content).toMatch(/関連\s*スキル|Related\s+skills?/);
      // 全体で /harness-merge-train の言及あり
      expect(content).toMatch(/\/harness-merge-train|harness-merge-train/);
    });
  });
});
