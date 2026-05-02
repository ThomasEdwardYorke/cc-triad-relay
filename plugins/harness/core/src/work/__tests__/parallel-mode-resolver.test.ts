/**
 * core/src/work/__tests__/parallel-mode-resolver.test.ts
 *
 * RED test for `resolveParallelMode` (`/harness-work` v6 D-harness-work-parallel-mode-v2).
 *
 * Spec source: `.docs/handoff/harness-model-b-backlog.md` Phase A-2 entry.
 *
 * Resolution precedence (highest first):
 *   1. cliFlag                      — `--parallel-mode=v1|v2`
 *   2. auto-rule failure-history    — `n_tasks >= 2 && recent_subagent_failures >= 2`
 *                                     gated on `allowAutoModelB`
 *   3. auto-rule task-count         — `n_tasks >= 3` gated on `allowAutoModelB`
 *   4. harnessConfigDefault         — `harness.config.json.work.parallelMode`
 *   5. default                      — `v1` (back-compat)
 *
 * Invalid `cliFlag` values fall through to the next source with a warning
 * (graceful degradation matches `profile-resolver` family conventions).
 */

import { describe, it, expect } from "vitest";
import {
  resolveParallelMode,
  VALID_PARALLEL_MODES,
} from "../parallel-mode-resolver.js";

describe("resolveParallelMode — precedence chain", () => {
  it("returns v1 by default when nothing is supplied", () => {
    const r = resolveParallelMode({});
    expect(r.mode).toBe("v1");
    expect(r.source).toBe("default");
    expect(r.warnings).toEqual([]);
  });

  it("VALID_PARALLEL_MODES exposes the v1 / v2 enum", () => {
    expect(VALID_PARALLEL_MODES).toEqual(["v1", "v2"]);
  });

  describe("cliFlag (highest precedence)", () => {
    it("v1 cliFlag wins over auto-rule that would pick v2", () => {
      const r = resolveParallelMode({
        cliFlag: "v1",
        nTasks: 5,
        recentSubagentFailures: 5,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("cli");
      expect(r.warnings).toEqual([]);
    });

    it("v2 cliFlag wins over harnessConfigDefault=v1", () => {
      const r = resolveParallelMode({
        cliFlag: "v2",
        harnessConfigDefault: "v1",
      });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("cli");
    });

    it("invalid cliFlag falls through to default with warning", () => {
      const r = resolveParallelMode({ cliFlag: "v3" });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("default");
      expect(r.warnings.length).toBe(1);
      expect(r.warnings[0]).toMatch(/--parallel-mode/);
      expect(r.warnings[0]).toMatch(/v3/);
      expect(r.warnings[0]).toMatch(/v1\/v2|v1\|v2/);
    });

    it("empty / whitespace-only cliFlag is treated as undefined", () => {
      expect(resolveParallelMode({ cliFlag: "" }).source).toBe("default");
      expect(resolveParallelMode({ cliFlag: "   " }).source).toBe("default");
    });
  });

  describe("auto-rule failure-history (n_tasks >= 2 && failures >= 2)", () => {
    it("downgrades to v2 when allowAutoModelB and 2 tasks + 2 recent failures", () => {
      const r = resolveParallelMode({
        nTasks: 2,
        recentSubagentFailures: 2,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("auto-failure-history");
    });

    it("does NOT trigger when allowAutoModelB is false (opt-in gate)", () => {
      const r = resolveParallelMode({
        nTasks: 2,
        recentSubagentFailures: 5,
        allowAutoModelB: false,
      });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("default");
    });

    it("does NOT trigger when nTasks < 2 even with many failures", () => {
      const r = resolveParallelMode({
        nTasks: 1,
        recentSubagentFailures: 10,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v1");
    });

    it("does NOT trigger when failures < 2", () => {
      const r = resolveParallelMode({
        nTasks: 2,
        recentSubagentFailures: 1,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v1");
    });
  });

  describe("auto-rule task-count (n_tasks >= 3)", () => {
    it("picks v2 when allowAutoModelB and nTasks >= 3 even with 0 failures", () => {
      const r = resolveParallelMode({
        nTasks: 3,
        recentSubagentFailures: 0,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("auto-task-count");
    });

    it("picks v2 for nTasks=4 / 10 alike", () => {
      expect(
        resolveParallelMode({ nTasks: 10, allowAutoModelB: true }).mode,
      ).toBe("v2");
    });

    it("does NOT trigger when allowAutoModelB is false", () => {
      const r = resolveParallelMode({ nTasks: 8, allowAutoModelB: false });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("default");
    });

    it("failure-history rule has higher precedence than task-count when both apply", () => {
      const r = resolveParallelMode({
        nTasks: 5,
        recentSubagentFailures: 3,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v2");
      // failure-history fires first since both rules return v2 — pick the one
      // that documents the WHY (failures triggered the downgrade).
      expect(r.source).toBe("auto-failure-history");
    });
  });

  describe("harnessConfigDefault", () => {
    it("v2 harnessConfigDefault wins when no cli / no auto rule applies", () => {
      const r = resolveParallelMode({ harnessConfigDefault: "v2" });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("harness-config");
    });

    it("v1 harnessConfigDefault is selected over default fallback", () => {
      const r = resolveParallelMode({ harnessConfigDefault: "v1" });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("harness-config");
    });

    it("auto-rule wins over harnessConfigDefault when both apply", () => {
      const r = resolveParallelMode({
        harnessConfigDefault: "v1",
        nTasks: 4,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("auto-task-count");
    });

    it("invalid harnessConfigDefault (untyped JSON leak) falls through with warning", () => {
      // Defensive validation: even though the config loader normally keeps
      // this on the allowlist, the resolver re-checks so a malformed payload
      // (`{"work":{"parallelMode":"v3"}}`) cannot leak an invalid mode to
      // the dispatcher. Cast to string to simulate an untyped caller.
      const r = resolveParallelMode({
        harnessConfigDefault: "v3" as unknown as string,
      });
      expect(r.mode).toBe("v1");
      expect(r.source).toBe("default");
      expect(r.warnings.length).toBe(1);
      expect(r.warnings[0]).toMatch(/harness\.config\.json/);
      expect(r.warnings[0]).toMatch(/v3/);
    });

    it("empty / whitespace-only harnessConfigDefault is treated as undefined", () => {
      expect(
        resolveParallelMode({ harnessConfigDefault: "" }).source,
      ).toBe("default");
      expect(
        resolveParallelMode({ harnessConfigDefault: "  " }).source,
      ).toBe("default");
    });
  });

  describe("warnings", () => {
    it("invalid cliFlag emits exactly one warning and falls through to default", () => {
      const r = resolveParallelMode({ cliFlag: "vX" });
      expect(r.warnings.length).toBe(1);
      expect(r.mode).toBe("v1");
    });

    it("invalid cliFlag carries through without polluting valid auto-rule decision", () => {
      const r = resolveParallelMode({
        cliFlag: "garbage",
        nTasks: 4,
        allowAutoModelB: true,
      });
      expect(r.mode).toBe("v2");
      expect(r.source).toBe("auto-task-count");
      expect(r.warnings.length).toBe(1);
    });
  });
});
