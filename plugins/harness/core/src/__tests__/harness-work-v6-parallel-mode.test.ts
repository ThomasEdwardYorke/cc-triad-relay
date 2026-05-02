/**
 * core/src/__tests__/harness-work-v6-parallel-mode.test.ts
 *
 * `/harness-work` v6 改訂 (D-harness-work-parallel-mode-v2: Auto Mode Detection
 * に Model B 経路を追加 + `--parallel-mode=v1|v2` flag 新設) を CI 時点で固定
 * する content test。
 *
 * 背景:
 *   `commands/harness-work.md` v5 までの Auto Mode Detection は **件数ベース**
 *   (1 / 2-3 / 4+) で Solo / Parallel / Breezing を選び、Parallel / Breezing は
 *   いずれも Model A (`/parallel-worktree` v1) に委譲していた。Model B
 *   (`/parallel-worktree-v2`) への自動委譲経路は spec 上 **未実装**。
 *
 * v6 改修 (本テストが固定する不変条件):
 *
 *   1. 新 flag `--parallel-mode=v1|v2` (default `v1`、互換維持)
 *   2. Auto downgrade rule: `n_tasks >= 2 && recent_subagent_failures >= 2`
 *      で v2 に降格 (`harness.config.json.work.allowAutoModelB: true` で opt-in)
 *   3. Auto default-v2 rule: `n_tasks >= 3` で v2 (同 opt-in gate)
 *   4. Step 4 委譲表に `/parallel-worktree-v2` 行が追加される
 *   5. v6 update history が末尾に追加され、D-harness-work-parallel-mode-v2 を
 *      引用 / spec gap (Model B 自動委譲経路) を明示
 *   6. v5 互換性破壊なし (merge mode / detect_merge_orchestration() / 既存
 *      mode lineup は不変)
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

describe("/harness-work v6 parallel-mode (commands/harness-work.md)", () => {
  const content = readSpec();

  // -----------------------------------------------------------------
  // 1. frontmatter v6 言及 + argument-hint に parallel-mode が含まれる
  // -----------------------------------------------------------------
  describe("frontmatter で v6 / parallel-mode を宣言", () => {
    it("description / description-ja のいずれかに v6 と parallel-mode 言及", () => {
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
      expect(fm).toMatch(/v6/);
      expect(fm).toMatch(/parallel-mode/);
    });

    it("argument-hint に parallel-mode token が含まれる (strict pipe form)", () => {
      // strict bracketed pipe form をそのまま継承 (v5 で導入)。
      expect(content).toMatch(
        /^argument-hint:\s*"\[[^"]*\bparallel-mode\b[^"]*\]"\s*$/m,
      );
    });
  });

  // -----------------------------------------------------------------
  // 2. options table / 説明節に `--parallel-mode=v1|v2` 行
  // -----------------------------------------------------------------
  describe("`--parallel-mode=v1|v2` flag の説明 / options 表", () => {
    it("`--parallel-mode=v1|v2` (literal) が flag として明示される", () => {
      expect(content).toMatch(/--parallel-mode=\s*v1\s*\|\s*v2/);
    });

    it("default が v1 (互換維持) であると明示", () => {
      // `default v1` / `デフォルト v1` / "default `v1`" 等を許容。
      expect(content).toMatch(
        /(?:default|デフォルト|既定)[^\n]{0,80}?(?:`v1`|"v1"|\bv1\b)/i,
      );
    });

    it("v1 = Model A / v2 = Model B 対応関係が説明される", () => {
      // v1 → /parallel-worktree (Model A), v2 → /parallel-worktree-v2 (Model B)
      expect(content).toMatch(/v1[\s\S]{0,200}?(?:Model\s*A|\/parallel-worktree\b)/i);
      expect(content).toMatch(
        /v2[\s\S]{0,200}?(?:Model\s*B|\/parallel-worktree-v2)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 3. Auto Mode Detection に Model B 経路 (failure-history + task-count)
  // -----------------------------------------------------------------
  describe("Auto Mode Detection の Model B 経路", () => {
    it("`recent_subagent_failures` 概念が Auto detection の判定に登場", () => {
      expect(content).toMatch(/recent_subagent_failures/);
    });

    it("`n_tasks >= 2 && recent_subagent_failures >= 2` を v2 降格条件として明示", () => {
      // 2 件以上のタスク + 過去 N 日で 2 件以上の subagent failure
      expect(content).toMatch(
        /n_tasks\s*>=?\s*2[\s\S]{0,300}?recent_subagent_failures\s*>=?\s*2|recent_subagent_failures\s*>=?\s*2[\s\S]{0,300}?n_tasks\s*>=?\s*2/,
      );
    });

    it("`n_tasks >= 3` で v2 default にする条件を明示 (`/parallel-worktree-v2` skill description 推奨に整合)", () => {
      expect(content).toMatch(
        /n_tasks\s*>=?\s*3[\s\S]{0,400}?(?:parallel-worktree-v2|Model\s*B|"v2"|`v2`)/i,
      );
    });

    it("`allowAutoModelB` opt-in gate (default false) を明示", () => {
      // harness.config.json の work.allowAutoModelB / allowAutoModelB という field 名
      expect(content).toMatch(/allowAutoModelB/);
      // default `false` (opt-in)
      expect(content).toMatch(
        /allowAutoModelB[\s\S]{0,200}?(?:default\s*[`"]?false[`"]?|opt-?in|デフォルト\s*false|既定\s*false)/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 4. Step 4 委譲表 / mode 対応表に /parallel-worktree-v2 行が追加
  // -----------------------------------------------------------------
  describe("委譲先 table に /parallel-worktree-v2 (Model B) が追加", () => {
    it("/parallel-worktree-v2 が委譲先として登場", () => {
      expect(content).toMatch(/\/parallel-worktree-v2/);
    });

    it("v2 mode → /parallel-worktree-v2 の mapping が明文化", () => {
      // mode == "v2" / parallel-mode=v2 が /parallel-worktree-v2 に dispatch される旨
      expect(content).toMatch(
        /(?:v2|parallel-mode=v2|Model\s*B)[\s\S]{0,400}?\/parallel-worktree-v2|\/parallel-worktree-v2[\s\S]{0,400}?(?:v2|parallel-mode=v2|Model\s*B)/i,
      );
    });

    it("PROFILE materialize 規約が parallel-mode dispatch でも継承", () => {
      // 4.1 / 4.2 と同じ "実値に materialize" 原則が parallel-mode 経路にも明示
      expect(content).toMatch(
        /parallel-worktree-v2[\s\S]{0,500}?(?:materialize|実値|PROFILE)|PROFILE[\s\S]{0,500}?parallel-worktree-v2/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 5. 関連スキル table に /parallel-worktree-v2 が追加
  // -----------------------------------------------------------------
  describe("関連スキル table に /parallel-worktree-v2 が追加", () => {
    it("Related skills / 関連スキル table 範囲に /parallel-worktree-v2 行", () => {
      // 関連スキル section の table 行 (`| ... | ... | ... |`) に
      // /parallel-worktree-v2 が現れること。
      const tableSection = content.match(
        /## (?:関連\s*スキル|Related\s+skills?)[\s\S]+?(?=^## |\Z)/m,
      )?.[0];
      expect(tableSection).toBeTruthy();
      expect(tableSection ?? "").toMatch(/\/parallel-worktree-v2/);
    });
  });

  // -----------------------------------------------------------------
  // 6. v6 update history
  // -----------------------------------------------------------------
  describe("更新履歴に v6 行が追加", () => {
    it("「v6」の更新履歴 entry が末尾近辺に存在", () => {
      // bullet "- **v6 (...)**: ..."
      expect(content).toMatch(/-\s*\*\*v6[^\n]+/);
    });

    it("v6 entry が D-harness-work-parallel-mode-v2 / Model B / parallel-mode flag を引用", () => {
      const v6Entry = content.match(/-\s*\*\*v6[\s\S]*?(?=\n-\s*\*\*v\d|\n##|$)/);
      expect(v6Entry).not.toBeNull();
      const body = v6Entry?.[0] ?? "";
      expect(body).toMatch(
        /parallel-mode|Model\s*B|parallel-worktree-v2|recent_subagent_failures|allowAutoModelB/i,
      );
    });
  });

  // -----------------------------------------------------------------
  // 7. v5 互換性破壊なし (merge mode + 既存 mode 維持)
  // -----------------------------------------------------------------
  describe("v5 互換性 (既存 mode + merge mode が壊れていない)", () => {
    const v5Modes = ["solo", "parallel", "breezing", "sequential", "merge"];
    for (const mode of v5Modes) {
      it(`既存 mode "${mode}" の言及が残っている`, () => {
        const escapedMode = mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `(?:mode\\s*=\\s*["']${escapedMode}["']|"${escapedMode}"|\`${escapedMode}\`)`,
        );
        expect(content).toMatch(re);
      });
    }

    it("`detect_merge_orchestration()` (v5) が残っている", () => {
      expect(content).toMatch(/detect_merge_orchestration\s*\(/);
    });

    it("件数ベース判定 (1 / 2-3 / 4+) が legacy 経路として保持", () => {
      expect(content).toMatch(/n_tasks\s*==\s*1|タスク数.*1\s*件|1\s*件.*solo/i);
      expect(content).toMatch(/n_tasks\s*<=?\s*3|2-3\s*件|2\s*to\s*3/i);
      expect(content).toMatch(/n_tasks\s*>?=?\s*4|4\s*件\s*以上|4\s*\+|4\s*or\s*more/i);
    });
  });
});
