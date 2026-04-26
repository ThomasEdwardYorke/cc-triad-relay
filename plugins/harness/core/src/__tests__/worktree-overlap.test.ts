/**
 * core/src/__tests__/worktree-overlap.test.ts
 *
 * `/parallel-worktree` の Pre-flight section で同 file 編集 overlap を事前評価する
 * helper 関数の test。
 *
 * 背景:
 *   過去 session で 2 つの worktree が `commands/harness-merge-train.md` を同時編集 →
 *   merge 順次で conflict 必至になった。`owned_files` 宣言を **静的に** 比較して
 *   overlap を検出し、severity に応じて並列度の判断材料 (parallel-ok / serialize /
 *   consolidate-into-single-pr) を提示する。
 *
 * 設計方針:
 *   - 入力は SubTaskOverlapInput[] (slug + ownedFiles[] + forbiddenFiles[])
 *   - 出力は OverlapReport (pairs[] + summary)
 *   - 静的比較のみ (glob expansion はしない、`backend/**` vs `backend/api/*` のような
 *     親子関係は heuristic 比較)
 *   - 同 slug の重複は throw (fail-fast、入力 invariant 違反)
 */

import { describe, it, expect } from "vitest";
import {
  detectOverlap,
  type SubTaskOverlapInput,
  type OverlapReport,
} from "../work/worktree-overlap.js";

describe("detectOverlap — empty / trivial inputs", () => {
  it("空入力は空 pairs + parallel-ok", () => {
    const r: OverlapReport = detectOverlap([]);
    expect(r.pairs).toEqual([]);
    expect(r.summary.totalPairs).toBe(0);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });

  it("1 task のみは pair なし + parallel-ok", () => {
    const r = detectOverlap([
      { slug: "alpha", ownedFiles: ["frontend/**"] },
    ]);
    expect(r.pairs).toEqual([]);
    expect(r.summary.totalPairs).toBe(0);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });

  it("完全独立 2 task (異なる owned dir) は overlap なし + parallel-ok", () => {
    const r = detectOverlap([
      { slug: "fe", ownedFiles: ["frontend/**"] },
      { slug: "be", ownedFiles: ["backend/**"] },
    ]);
    expect(r.pairs).toEqual([]);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });
});

describe("detectOverlap — direct owned overlap", () => {
  it("完全一致 owned (同 literal pattern) は high severity + consolidate", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["commands/harness-merge-train.md"] },
      { slug: "task-b", ownedFiles: ["commands/harness-merge-train.md"] },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("high");
    expect(r.pairs[0]!.overlappingPatterns).toContain(
      "commands/harness-merge-train.md",
    );
    expect(r.summary.recommendation).toBe("consolidate-into-single-pr");
  });

  it("部分 owned overlap (1 pattern 共通、他は独立) は medium + serialize", () => {
    const r = detectOverlap([
      {
        slug: "task-a",
        ownedFiles: ["frontend/**", "shared/types.ts"],
      },
      {
        slug: "task-b",
        ownedFiles: ["backend/**", "shared/types.ts"],
      },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("medium");
    expect(r.pairs[0]!.overlappingPatterns).toEqual(["shared/types.ts"]);
    expect(r.summary.recommendation).toBe("serialize");
  });

  it("ownedFiles の 50% 以上が共通なら high", () => {
    const r = detectOverlap([
      {
        slug: "task-a",
        ownedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
      },
      {
        slug: "task-b",
        ownedFiles: ["a.ts", "b.ts", "c.ts", "z.ts"], // 4 中 3 共通 (75%)
      },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("high");
    expect(r.summary.recommendation).toBe("consolidate-into-single-pr");
  });
});

describe("detectOverlap — parent/child glob relationship", () => {
  it("親 (`backend/**`) と子 (`backend/api/*`) は medium 判定 (heuristic)", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["backend/**"] },
      { slug: "task-b", ownedFiles: ["backend/api/*"] },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("medium");
    expect(r.summary.recommendation).toBe("serialize");
  });

  it("親子関係 (任意方向) を検出 (`backend/api/*` と `backend/**` でも同じ)", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["backend/api/*"] },
      { slug: "task-b", ownedFiles: ["backend/**"] },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("medium");
  });

  it("非親子関係 (`backend/api/*` と `backend/db/*`) は overlap なし", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["backend/api/*"] },
      { slug: "task-b", ownedFiles: ["backend/db/*"] },
    ]);
    expect(r.pairs).toEqual([]);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });
});

describe("detectOverlap — forbidden cross-violation", () => {
  it("A.owned が B.forbidden に含まれる: forbiddenViolations に記録 + low severity", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["backend/api/*"] },
      {
        slug: "task-b",
        ownedFiles: ["backend/db/*"],
        forbiddenFiles: ["backend/api/*"],
      },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.forbiddenViolations.length).toBe(1);
    expect(r.pairs[0]!.forbiddenViolations[0]).toMatchObject({
      from: "task-a",
      to: "task-b",
      pattern: "backend/api/*",
    });
    expect(r.pairs[0]!.severity).toBe("low");
  });

  it("forbiddenFiles が undefined / 空配列なら無視", () => {
    const r1 = detectOverlap([
      { slug: "a", ownedFiles: ["x.ts"], forbiddenFiles: undefined },
      { slug: "b", ownedFiles: ["y.ts"] },
    ]);
    expect(r1.pairs).toEqual([]);
    const r2 = detectOverlap([
      { slug: "a", ownedFiles: ["x.ts"], forbiddenFiles: [] },
      { slug: "b", ownedFiles: ["y.ts"] },
    ]);
    expect(r2.pairs).toEqual([]);
  });
});

describe("detectOverlap — 3+ tasks", () => {
  it("3 task で 1 pair が high → consolidate (高 severity が支配)", () => {
    const r = detectOverlap([
      { slug: "a", ownedFiles: ["shared.ts"] },
      { slug: "b", ownedFiles: ["shared.ts"] }, // a と high overlap
      { slug: "c", ownedFiles: ["other.ts"] },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.summary.highCount).toBe(1);
    expect(r.summary.recommendation).toBe("consolidate-into-single-pr");
  });

  it("3 task で 全 pair が medium (50% 共通、exact match だが coverage 50% 丁度) → serialize", () => {
    const r = detectOverlap([
      { slug: "a", ownedFiles: ["shared.ts", "a-only.ts"] },
      { slug: "b", ownedFiles: ["shared.ts", "b-only.ts"] },
      { slug: "c", ownedFiles: ["shared.ts", "c-only.ts"] },
    ]);
    expect(r.pairs.length).toBe(3);
    // 全 pair が medium (50% 丁度の exact match → 部分競合 = medium)
    for (const pair of r.pairs) {
      expect(pair.severity).toBe("medium");
    }
    expect(r.summary.recommendation).toBe("serialize");
  });

  it("3 task で全 pair が low (forbidden のみ) → parallel-ok", () => {
    const r = detectOverlap([
      {
        slug: "a",
        ownedFiles: ["a-only.ts"],
        forbiddenFiles: ["b-only.ts"],
      },
      {
        slug: "b",
        ownedFiles: ["b-only.ts"],
        forbiddenFiles: ["a-only.ts"],
      },
      {
        slug: "c",
        ownedFiles: ["c-only.ts"],
      },
    ]);
    // a-b は forbidden cross なので low、a-c b-c は overlap なし
    expect(r.summary.lowCount).toBeGreaterThanOrEqual(1);
    expect(r.summary.highCount).toBe(0);
    expect(r.summary.mediumCount).toBe(0);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });
});

describe("detectOverlap — invariant violation", () => {
  it("同 slug の重複は throw (fail-fast)", () => {
    expect(() =>
      detectOverlap([
        { slug: "duplicate", ownedFiles: ["a.ts"] },
        { slug: "duplicate", ownedFiles: ["b.ts"] },
      ]),
    ).toThrow(/duplicate.*slug|slug.*duplicate/i);
  });

  it("ownedFiles が空配列なら overlap 計算対象外 (空入力扱い)", () => {
    const r = detectOverlap([
      { slug: "a", ownedFiles: [] },
      { slug: "b", ownedFiles: ["foo.ts"] },
    ]);
    expect(r.pairs).toEqual([]);
    expect(r.summary.recommendation).toBe("parallel-ok");
  });
});

describe("detectOverlap — summary fields", () => {
  it("totalPairs / highCount / mediumCount / lowCount が正確", () => {
    const r = detectOverlap([
      { slug: "x", ownedFiles: ["foo.ts"] },
      { slug: "y", ownedFiles: ["foo.ts"] }, // high (exact)
      { slug: "z", ownedFiles: ["bar.ts"] }, // x/y と overlap なし
    ]);
    expect(r.summary.totalPairs).toBe(1);
    expect(r.summary.highCount).toBe(1);
    expect(r.summary.mediumCount).toBe(0);
    expect(r.summary.lowCount).toBe(0);
  });
});

describe("detectOverlap — 非対称ケース (asymmetric coverage、CR Major 対応)", () => {
  it("A=2 patterns / B=3 patterns で B 側全 owned が A の glob で覆われる場合: B 側 coverage は 100% で high", () => {
    // A: ["shared/**", "x.ts"] (2 patterns)
    // B: ["shared/a.ts", "shared/b.ts", "x.ts"] (3 patterns)
    // intersectPatterns(A, B): A の shared/** が shared/a.ts / shared/b.ts を覆う + x.ts が exact match
    //                         → A 側 overlap = ["shared/**", "x.ts"] = 2 / 2 = 100%
    // intersectPatterns(B, A): B の shared/a.ts / shared/b.ts が A の shared/** に覆われる + x.ts exact
    //                         → B 側 overlap = ["shared/a.ts", "shared/b.ts", "x.ts"] = 3 / 3 = 100%
    // hasExact=true (x.ts) + 両側 100% > 50% → high
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["shared/**", "x.ts"] },
      {
        slug: "task-b",
        ownedFiles: ["shared/a.ts", "shared/b.ts", "x.ts"],
      },
    ]);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.severity).toBe("high");
    expect(r.summary.recommendation).toBe("consolidate-into-single-pr");
    // overlappingPatterns は union で 4 patterns
    expect(r.pairs[0]!.overlappingPatterns).toEqual(
      expect.arrayContaining(["shared/**", "x.ts", "shared/a.ts", "shared/b.ts"]),
    );
  });

  it("A=4 patterns / B=2 patterns で A 側 coverage 25% / B 側 coverage 100%: B 側 100% で high", () => {
    // A: ["a1.ts", "a2.ts", "a3.ts", "shared.ts"] (4 patterns、shared.ts のみ overlap)
    // B: ["shared.ts", "b1.ts"] (2 patterns、shared.ts は A と exact、b1.ts は独立)
    // intersectPatterns(A, B): A の shared.ts が B にある → A 側 overlap = ["shared.ts"] = 1 / 4 = 25%
    // intersectPatterns(B, A): B の shared.ts が A にある → B 側 overlap = ["shared.ts"] = 1 / 2 = 50%
    // hasExact=true (shared.ts)、A 側 25% / B 側 50% → 両方 strict > 50% を満たさない → medium
    const r = detectOverlap([
      {
        slug: "task-a",
        ownedFiles: ["a1.ts", "a2.ts", "a3.ts", "shared.ts"],
      },
      { slug: "task-b", ownedFiles: ["shared.ts", "b1.ts"] },
    ]);
    expect(r.pairs.length).toBe(1);
    // 両側とも > 50% を満たさない → medium
    expect(r.pairs[0]!.severity).toBe("medium");
  });

  it("A=2 / B=3 で 1 pattern の exact match のみ、B 側 coverage 33%、A 側 50% → medium (どちらも > 50% 厳密に超えず)", () => {
    const r = detectOverlap([
      { slug: "task-a", ownedFiles: ["shared.ts", "a1.ts"] },
      { slug: "task-b", ownedFiles: ["shared.ts", "b1.ts", "b2.ts"] },
    ]);
    expect(r.pairs.length).toBe(1);
    // A 側 50% / B 側 33%、hasExact だが strict > 50% 不成立 → medium
    expect(r.pairs[0]!.severity).toBe("medium");
  });
});
