/**
 * core/src/__tests__/pwt-p0-improvements.test.ts
 *
 * 観測された parallel-worktree subagent failure mode (intent 文を残したまま
 * 停止し、coordinator がそれを完了と誤認した pattern) に対する P0 改善案を
 * prompt content 上の不変条件として固定する regression test。
 *
 * 守りたい不変条件 (P0、stack-neutral):
 *
 *   P0-1+2+4 (agents/worker.md):
 *     1. Completion Gate — DONE / PARTIAL / BLOCKED / FAILED の 4 status と
 *        未来形禁止 (「します」「実行します」「修正します」「確認します」「更新します」)
 *     2. Budget Gate — **25 / 30 / 35 / 40 tool checkpoints** (frontmatter
 *        `maxTurns: 40` hard limit と一致、当初提案の 45 checkpoint は論理矛盾で
 *        削除済)。intent 文で停止する failure mode 撲滅
 *     3. Forbidden Infrastructure Workarounds — generic な
 *        database-specific workaround 禁止 (migration skip / 手動 SQL /
 *        version-specific syntax 書換 / fake schema) + INFRA_BLOCKED 報告経路
 *     4. 8-field final schema — STATUS / CHANGED_FILES / COMMIT / PUSHED_BRANCH /
 *        VALIDATION / BLOCKERS / NEXT_ACTION / FORBIDDEN_ACTIONS_USED、
 *        空値表現は `(none)` で統一
 *
 *   P0-3 (commands/parallel-worktree.md, commands/tdd-implement.md):
 *     5. Environment Manifest を coordinator が worker prompt 先頭に注入する
 *        contract (PG version / known infra limitation / forbidden actions)
 *
 *   P0-5 (commands/parallel-worktree.md, commands/harness-work.md):
 *     6. Coordinator 側 worker final 機械的確認 — git status / log / push
 *        verification + 未来形 detector + BLOCKED / PARTIAL handoff parser
 *
 *   P1-3 promoted to P0 (agents/codex-sync.md):
 *     7. Future-tense ban (final で intent 文の宣言終了を禁止)
 *     8. Final schema marker (PATCH_APPLIED / FINDINGS_ONLY) で 10-tool budget
 *        の child agent を read-only review または 1-fix scope に限定
 *
 * 全て文字列含有 + regex マッチで検証する低結合 assertion. prompt content の
 * 一字一句を縛らず、契約上必須な keyword / 構造的位置のみを CI で固定する.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

function readAgent(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "agents", `${name}.md`), "utf-8");
}

function readCommand(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "commands", `${name}.md`), "utf-8");
}

// =============================================================================
// P0-1+2+4: agents/worker.md
// =============================================================================

describe("P0-1+2+4: agents/worker.md — subagent failure mode 撲滅", () => {
  const content = readAgent("worker");

  describe("P0-1: Completion Gate (4-status + 未来形 ban)", () => {
    it("Completion Gate / 完了契約 / Completion Contract セクションが存在", () => {
      expect(content).toMatch(/Completion\s+Gate|完了契約|Completion\s+Contract|完了\s*ゲート/i);
    });

    it("DONE / PARTIAL / BLOCKED / FAILED の 4 status を明示する", () => {
      expect(content).toMatch(/\bDONE\b/);
      expect(content).toMatch(/\bPARTIAL\b/);
      expect(content).toMatch(/\bBLOCKED\b/);
      expect(content).toMatch(/\bFAILED\b/);
    });

    it("未来形禁止の日本語 trigger 語 (します / 実行します / 修正します / 確認します / 更新します) を列挙", () => {
      expect(content).toMatch(/未来形|future[\s-]?tense/i);
      // 5 trigger 語のうち少なくとも 4 つを明文で列挙
      const triggers = ["実行します", "修正します", "確認します", "更新します", "します"];
      const hits = triggers.filter((t) => content.includes(t));
      expect(hits.length).toBeGreaterThanOrEqual(4);
    });

    it("未来形 final を完了として扱わない旨を明示", () => {
      expect(content).toMatch(
        /未来形.*(?:完了|DONE).*(?:扱わない|ない|禁止|nope|不可)|未来形.*禁止|不可.*未来形|完了\s*として\s*扱わない|interrupted|incomplete|未完了/i,
      );
    });

    it("budget 不足時は完了報告でなく PARTIAL / BLOCKED として返す経路を明示", () => {
      expect(content).toMatch(
        /budget.*(?:PARTIAL|BLOCKED)|(?:PARTIAL|BLOCKED).*budget|予算.*(?:撤退|partial|blocked)|tool.*(?:exhaust|尽き|枯渇).*(?:PARTIAL|BLOCKED)/i,
      );
    });
  });

  describe("P0-2: Budget Gate (25 / 30 / 35 / 40 tool checkpoints aligned with maxTurns: 40)", () => {
    it("Budget Gate / 予算ゲート / Tool Budget セクションが存在", () => {
      expect(content).toMatch(/Budget\s+Gate|予算\s*ゲート|Tool\s+Budget\b|tool\s+call\s+budget/i);
    });

    it("25 tool checkpoint (進捗 report / consolidate) を明示", () => {
      expect(content).toMatch(/25\s*tool[\s\S]{0,200}?(?:進捗|現状|整理|状況|consolidat|status\s*check|report)/i);
    });

    it("30 tool checkpoint (新規探索禁止 / 収束) を明示", () => {
      expect(content).toMatch(
        /30\s*tool[\s\S]{0,200}?(?:新規\s*探索\s*禁止|exploration\s+stop|stop\s+exploration|探索\s*停止|converge|収束|新規探索)/i,
      );
    });

    it("35 tool checkpoint (commit / PARTIAL handoff) を明示", () => {
      expect(content).toMatch(
        /35\s*tool[\s\S]{0,200}?(?:commit|PARTIAL|handoff|finaliz|撤退|partial\s*report)/i,
      );
    });

    it("40 tool checkpoint (finalization-only、maxTurns: 40 hard limit と一致) を明示", () => {
      expect(content).toMatch(
        /40\s*tool[\s\S]{0,200}?(?:finaliz|finalization\s*only|終了|完了処理|新規\s*investig|new\s+investigation|新規\s*作業\s*禁止|hard\s*limit|maxTurns)/i,
      );
    });

    it("Budget Gate の最大値が frontmatter `maxTurns: 40` を超えない (45 tool checkpoint を持たない)", () => {
      // CRITICAL fix: 45 tool は maxTurns: 40 を超えるため論理矛盾。45 を含めないこと。
      // 表中で「45 tool」が新規 checkpoint として使われていないこと (regex で row 単位検査)。
      expect(content).not.toMatch(/^\s*\|\s*\*\*45\s*tool\*\*/m);
    });
  });

  describe("P0-4: Forbidden Infrastructure Workarounds", () => {
    it("Forbidden Infrastructure Workarounds / 禁止迂回 セクションが存在", () => {
      expect(content).toMatch(
        /Forbidden\s+Infrastructure|禁止\s*迂回|infrastructure\s+workaround|infra\s+bypass|infra\s+workaround|infra\s+迂回/i,
      );
    });

    it("alembic skip / migration bypass を禁止と明示", () => {
      expect(content).toMatch(
        /(?:alembic[\s\S]{0,80}?(?:skip|bypass|スキップ|迂回))|(?:migration[\s\S]{0,80}?(?:skip|bypass|スキップ|迂回))/i,
      );
    });

    it("手動 SQL での test DB セットアップ禁止を明示", () => {
      expect(content).toMatch(
        /(?:manual\s+SQL|手動\s*SQL)[\s\S]{0,150}?(?:setup|セットアップ|test\s+DB|fixture|fake|手動|fake\s+schema)/i,
      );
    });

    it("version-specific syntax 書換禁止 (generic、local 環境の syntax を書換える迂回禁止) を明示", () => {
      // 旧 expectation `NULLS NOT DISTINCT` + `PG 14` は parts-management specific 漏洩 (CR R2 指摘)。
      // generic に version-specific syntax の書換禁止が明示されていれば足りる。
      expect(content).toMatch(/version[-\s]specific\s+syntax/i);
      expect(content).toMatch(
        /local\s*(?:のみ|だけ|-only|environment|環境)|local-only|local\s+variant/i,
      );
    });

    it("INFRA_BLOCKED 報告経路を明示 (DB workaround を続けない)", () => {
      expect(content).toMatch(/INFRA[_\s-]?BLOCKED/);
    });
  });

  describe("P0-1: 8-field final schema", () => {
    it("STATUS / CHANGED_FILES / COMMIT / PUSHED_BRANCH の 4 field 必須", () => {
      expect(content).toMatch(/\bSTATUS\b/);
      expect(content).toMatch(/CHANGED[_\s-]?FILES/);
      expect(content).toMatch(/\bCOMMIT\b/);
      expect(content).toMatch(/PUSHED[_\s-]?BRANCH/);
    });

    it("VALIDATION / BLOCKERS / NEXT_ACTION / FORBIDDEN_ACTIONS_USED の 4 field 必須", () => {
      expect(content).toMatch(/\bVALIDATION\b/);
      expect(content).toMatch(/\bBLOCKERS\b/);
      expect(content).toMatch(/NEXT[_\s-]?ACTION/);
      expect(content).toMatch(/FORBIDDEN[_\s-]?ACTIONS[_\s-]?USED/);
    });
  });

  describe("frontmatter 不変条件 (regression guard)", () => {
    it("frontmatter `name: worker` を維持", () => {
      expect(content).toMatch(/^---[\s\S]*?name:\s*worker/);
    });

    it("maxTurns は明示されている (40 のままでも、増減でも明示は必須)", () => {
      expect(content).toMatch(/maxTurns:\s*\d+/);
    });
  });

  describe("Late-finalization safeguard (status-marker first、dogfood-driven safeguard)", () => {
    it("Late-finalization safeguard / status-marker first セクションが存在", () => {
      expect(content).toMatch(
        /Late-finalization\s+safeguard|status-?marker\s+first|finalization\s+frame/i,
      );
    });

    it("`STATUS:` 行を最初に出力する旨を明示 (8-field schema の他 field より前)", () => {
      // 「最初に」「最初」「先頭」「first」相当の動詞 + STATUS field 言及
      expect(content).toMatch(
        /STATUS[\s\S]{0,300}?(?:最初|先頭|first|まず|冒頭)|(?:最初|先頭|first|まず|冒頭)[\s\S]{0,300}?STATUS/i,
      );
    });

    it("補足セクションの未来形を NEXT_ACTION に閉じ込める旨を明示", () => {
      expect(content).toMatch(
        /(?:NEXT_ACTION|next-action|next\s*action)[\s\S]{0,300}?(?:閉じ込め|限定|含める|入れる|confine|restrict)|未来形[\s\S]{0,300}?NEXT_ACTION/i,
      );
    });
  });
});

// =============================================================================
// P1-3 promoted to P0: agents/codex-sync.md
// =============================================================================

describe("P1-3 (P0 入り): agents/codex-sync.md — child agent budget exhaustion 撲滅", () => {
  const content = readAgent("codex-sync");

  describe("Future-tense ban (final で intent 文を完了として扱わない)", () => {
    it("未来形禁止 / future-tense ban の明文化", () => {
      expect(content).toMatch(/未来形|future[\s-]?tense/i);
    });

    it("`修正します` 等の intent 文での終了禁止を明示", () => {
      expect(content).toMatch(
        /修正します|実行します|確認します|going\s+to\s+(?:fix|run)|will\s+(?:fix|run|update)/i,
      );
    });
  });

  describe("Final schema marker (PATCH_APPLIED / FINDINGS_ONLY)", () => {
    it("PATCH_APPLIED status を明示", () => {
      expect(content).toMatch(/PATCH[_\s-]?APPLIED/);
    });

    it("FINDINGS_ONLY status を明示", () => {
      expect(content).toMatch(/FINDINGS[_\s-]?ONLY/);
    });

    it("read-only review または 1-fix scope に限定する旨を明示", () => {
      expect(content).toMatch(
        /read-?only\s+review|1[\s-]?(?:file|fix)\s+(?:1[\s-]?(?:file|fix)|scope)|narrow\s+scope|1\s*ファイル\s*1\s*修正/i,
      );
    });
  });

  describe("frontmatter 不変条件", () => {
    it("frontmatter `name: codex-sync` を維持", () => {
      expect(content).toMatch(/^---[\s\S]*?name:\s*codex-sync/);
    });
  });

  describe("Late-finalization safeguard (worker.md と対称、symmetric fix)", () => {
    it("Late-finalization safeguard / marker-first セクションが存在", () => {
      expect(content).toMatch(
        /Late-finalization\s+safeguard|marker-?first|finalization\s+frame/i,
      );
    });

    it("`PATCH_APPLIED` / `FINDINGS_ONLY` の marker を最後に emit する契約と整合", () => {
      // marker は last non-empty line である規約は既存 + 新 safeguard で
      // 「finalization frame に入った瞬間 emit する」ことを明示
      expect(content).toMatch(
        /(?:PATCH_APPLIED|FINDINGS_ONLY)[\s\S]{0,300}?(?:last\s+non-?empty\s+line|最後|finalization\s+frame|directly|immediately)/i,
      );
    });

    it("worker.md との対称性 (symmetric to agents/worker.md) を明示", () => {
      expect(content).toMatch(
        /(?:symmetric|対称)[\s\S]{0,300}?(?:agents\/worker\.md|worker\.md|worker\s+agent)|(?:agents\/worker\.md|worker\.md|worker\s+agent)[\s\S]{0,300}?(?:symmetric|対称)/i,
      );
    });
  });
});

// =============================================================================
// P0-3 + P0-5: commands/parallel-worktree.md
// =============================================================================

describe("P0-3 + P0-5: commands/parallel-worktree.md — coordinator contract 強化", () => {
  const content = readCommand("parallel-worktree");

  describe("P0-3: Environment Manifest injection (worker dispatch 時)", () => {
    it("Environment Manifest セクションが存在", () => {
      expect(content).toMatch(/Environment\s+Manifest|環境\s*マニフェスト|環境制約\s*マニフェスト/i);
    });

    it("local 環境と CI 環境の差分概念を例示として含む (generic、project-specific でない)", () => {
      // 旧 expectation `PG 14 / PG 15+` は parts-management specific 漏洩 (CR R2 指摘)。
      // generic な version-difference / local-vs-CI 概念で表現される旨だけ verify。
      expect(content).toMatch(
        /local\s+(?:environment|環境)|CI\s+(?:environment|環境)|local.*CI|CI.*local|version\s*(?:差分|差|mismatch|difference)|local-only|CI と同等|version[-\s]specific/i,
      );
    });

    it("version-specific syntax / unsupported feature の概念を例示として記述 (generic)", () => {
      // 旧 expectation `NULLS NOT DISTINCT` は project-specific reference (CR R2 指摘)。
      // generic な `version-specific syntax` / `unsupported syntax / feature` 等の概念で十分。
      expect(content).toMatch(
        /version[-\s]specific\s+syntax|unsupported\s+(?:syntax|feature)|DB[-\s]specific\s+syntax|DB\s+feature[s]?\s+(?:not\s+)?(?:supported|unavailable|unsupported)/i,
      );
    });

    it("worker prompt 先頭への注入を明示", () => {
      expect(content).toMatch(
        /(?:Environment\s+Manifest|環境\s*マニフェスト)[\s\S]{0,400}?(?:prompt\s+先頭|先頭\s*に\s*注入|inject|prepend|prompt\s+冒頭|prompt\s+top)/i,
      );
    });

    it("known infra limitation の概念を明示", () => {
      expect(content).toMatch(
        /known\s+infra(?:structure)?\s+(?:limitation|constraint)|既知\s*の?\s*infra|既知\s*制約|既知\s*の?\s*環境制約/i,
      );
    });
  });

  describe("P0-5: Coordinator 機械的最終確認 (worker final verification)", () => {
    it("機械的最終確認 / mechanical verification セクションが存在", () => {
      expect(content).toMatch(
        /機械(?:的)?\s*(?:最終)?\s*確認|mechanical\s+verification|coordinator\s+verification|機械\s*検証/i,
      );
    });

    it("git status / git log 確認を明示", () => {
      expect(content).toMatch(/git\s+status[\s\S]{0,200}?git\s+log|git\s+log[\s\S]{0,200}?git\s+status/i);
    });

    it("push 到達確認で local/remote commit hash 一致まで verify することを明示 (regression: hash 比較が消えると detect)", () => {
      // 弱い regex (mention だけで pass) は hash equality 退行を検知できないため、
      // LOCAL_COMMIT / REMOTE_COMMIT identifier または "hash mismatch" / "local
      // HEAD == remote ref" 等 hash 比較を表す語彙を必須化する。
      expect(content).toMatch(
        /LOCAL_COMMIT|REMOTE_COMMIT|local\s*HEAD[\s\S]{0,200}remote[\s\S]{0,200}(?:hash|commit)[\s\S]{0,200}(?:一致|match|mismatch|equal)|hash[\s\S]{0,80}(?:一致|match|mismatch|equal)/i,
      );
    });

    it("未来形 detector / future-tense detection を明示", () => {
      expect(content).toMatch(
        /未来形\s*(?:detect|検出|検知)|future[\s-]?tense\s+detect|未来形\s*検査|tail\s+末尾.*未来形|末尾.*未来形/i,
      );
    });

    it("BLOCKED / PARTIAL handoff parser を明示", () => {
      expect(content).toMatch(
        /(?:BLOCKED|PARTIAL)[\s\S]{0,200}?(?:parser|parse|検出|分類|handoff)|handoff[\s\S]{0,200}?(?:BLOCKED|PARTIAL)/i,
      );
    });
  });
});

// =============================================================================
// P0-3: commands/tdd-implement.md (Solo モード)
// =============================================================================

describe("P0-3: commands/tdd-implement.md — Solo モードでも Environment Manifest 取込", () => {
  const content = readCommand("tdd-implement");

  it("Environment Manifest 取込が Phase 1 計画に明示", () => {
    expect(content).toMatch(/Environment\s+Manifest|環境\s*マニフェスト|環境制約\s*マニフェスト/i);
  });

  it("known infra limitation を Phase 1 で扱う旨を明示", () => {
    expect(content).toMatch(
      /known\s+infra(?:structure)?\s+(?:limitation|constraint)|既知\s*infra|既知\s*環境制約|infra\s*制約/i,
    );
  });
});

// =============================================================================
// P0-5: commands/harness-work.md (dispatcher Step 5 強化)
// =============================================================================

describe("P0-5: commands/harness-work.md — Step 5 完了確認の機械化", () => {
  const content = readCommand("harness-work");

  it("Step 5 完了確認に未来形 detector / BLOCKED-PARTIAL parser を明示", () => {
    // Step 5 周辺で worker / 委譲先 final の機械検証契約を強化
    expect(content).toMatch(
      /未来形\s*(?:detect|検出|検知|検査)|future[\s-]?tense\s+detect|未来形\s*scan/i,
    );
    expect(content).toMatch(
      /(?:BLOCKED|PARTIAL)[\s\S]{0,200}?(?:parser|parse|検出|分類|handoff)|handoff[\s\S]{0,200}?(?:BLOCKED|PARTIAL)/i,
    );
  });

  it("8-field schema 検証 (worker final schema との整合) を明示", () => {
    // dispatcher 側でも委譲先 worker が 8-field schema を満たしたか機械確認する
    expect(content).toMatch(
      /(?:STATUS|CHANGED[_\s-]?FILES|COMMIT|PUSHED[_\s-]?BRANCH|FORBIDDEN[_\s-]?ACTIONS[_\s-]?USED)[\s\S]{0,200}?(?:schema|検証|verify|確認)|(?:schema|検証|verify)[\s\S]{0,200}?(?:STATUS|CHANGED[_\s-]?FILES|COMMIT|PUSHED[_\s-]?BRANCH)/i,
    );
  });
});
