/**
 * core/src/__tests__/context-audit-core.test.ts
 *
 * Red-phase tests for the `core/src/context-audit/index.ts` engine.
 *
 * Coverage:
 *   - `runContextAudit` 3-gate verdict / exit code mapping
 *   - `predictBudgetImpact` Write-targeted budget projection
 *   - `isAutoLoadTarget` directory-membership helper
 *   - `aggregateVerdict` / `computeExitCode` pure helpers
 *
 * Fixture pattern mirrors `post-tool-use-failure.test.ts`:
 *   - `mkdtempSync` for an isolated project root per test
 *   - `writeFileSync` to populate `.claude/rules/`, `docs/ai-rules/`, etc.
 *   - `afterEach` cleans up
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runContextAudit,
  predictBudgetImpact,
  isAutoLoadTarget,
  aggregateVerdict,
  computeExitCode,
  type ContextAuditSignal,
} from "../context-audit/index.js";
import type { ContextBudgetConfig } from "../config.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function defaultConfig(
  overrides: Partial<ContextBudgetConfig> = {},
): ContextBudgetConfig {
  return {
    enabled: true,
    budgetBytes: 35000,
    autoLoadDirs: [".claude/rules"],
    onDemandDirs: ["docs/ai-rules"],
    entryPointFiles: ["CLAUDE.md", "README.md"],
    indexFile: "",
    ...overrides,
  };
}

function makeProject(layout: {
  rules?: Record<string, string>;
  onDemand?: Record<string, string>;
  entryPoint?: { name: string; content: string };
}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-ctxaudit-test-"));
  tempDirs.push(dir);
  if (layout.rules) {
    mkdirSync(join(dir, ".claude/rules"), { recursive: true });
    for (const [name, content] of Object.entries(layout.rules)) {
      writeFileSync(join(dir, ".claude/rules", name), content, "utf-8");
    }
  }
  if (layout.onDemand) {
    mkdirSync(join(dir, "docs/ai-rules"), { recursive: true });
    for (const [name, content] of Object.entries(layout.onDemand)) {
      writeFileSync(join(dir, "docs/ai-rules", name), content, "utf-8");
    }
  }
  if (layout.entryPoint) {
    writeFileSync(
      join(dir, layout.entryPoint.name),
      layout.entryPoint.content,
      "utf-8",
    );
  }
  return dir;
}

// ============================================================
// Pure helpers
// ============================================================

describe("aggregateVerdict", () => {
  it("returns 'pass' for empty signal list", () => {
    expect(aggregateVerdict([])).toBe("pass");
  });

  it("elevates to 'warn' on any warn signal", () => {
    const sigs: ContextAuditSignal[] = [
      { id: "size", status: "pass", detail: "" },
      { id: "dead-link", status: "warn", detail: "two suspect links" },
    ];
    expect(aggregateVerdict(sigs)).toBe("warn");
  });

  it("elevates to 'fail' on any fail signal", () => {
    const sigs: ContextAuditSignal[] = [
      { id: "size", status: "pass", detail: "" },
      { id: "entry-point", status: "fail", detail: "no committed entry point" },
    ];
    expect(aggregateVerdict(sigs)).toBe("fail");
  });

  it("'skip' status never elevates", () => {
    const sigs: ContextAuditSignal[] = [
      { id: "size", status: "skip", detail: "no autoLoadDirs configured" },
      { id: "dead-link", status: "pass", detail: "" },
      { id: "entry-point", status: "pass", detail: "" },
    ];
    expect(aggregateVerdict(sigs)).toBe("pass");
  });
});

describe("computeExitCode", () => {
  it("returns 0 when nothing fails", () => {
    expect(
      computeExitCode([
        { id: "size", status: "pass", detail: "" },
        { id: "dead-link", status: "warn", detail: "" },
      ]),
    ).toBe(0);
  });

  it("bit-OR maps to parts-management precedent", () => {
    const sigs: ContextAuditSignal[] = [
      { id: "size", status: "fail", detail: "over by 100 bytes" },
      { id: "dead-link", status: "fail", detail: "1 dead link" },
      { id: "entry-point", status: "fail", detail: "no entry point" },
    ];
    expect(computeExitCode(sigs)).toBe(1 | 2 | 4);
  });
});

describe("isAutoLoadTarget", () => {
  it("matches relative path under autoLoadDirs", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-ctxaudit-iat-"));
    tempDirs.push(root);
    expect(
      isAutoLoadTarget(".claude/rules/foo.md", [".claude/rules"], root),
    ).toBe(true);
  });

  it("rejects absolute path outside autoLoadDirs", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-ctxaudit-iat-"));
    tempDirs.push(root);
    expect(
      isAutoLoadTarget("/etc/passwd", [".claude/rules"], root),
    ).toBe(false);
  });

  it("rejects path-traversal entries", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-ctxaudit-iat-"));
    tempDirs.push(root);
    expect(
      isAutoLoadTarget("../../../.claude/rules/foo.md", [".claude/rules"], root),
    ).toBe(false);
  });
});

// ============================================================
// runContextAudit — 3-gate audit
// ============================================================

describe("runContextAudit", () => {
  it("returns PASS for empty `.claude/rules/` with no entry-point requirement", async () => {
    const root = makeProject({});
    const result = await runContextAudit({
      projectRoot: root,
      // No entry-point requirement when entryPointFiles is empty
      config: defaultConfig({ entryPointFiles: [] }),
    });
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.totalBytes).toBe(0);
    expect(result.overBytes).toBe(0);
  });

  it("returns FAIL when total .md size exceeds budgetBytes", async () => {
    const big = "x".repeat(40000); // 40 000 bytes vs 1 000-byte budget
    const root = makeProject({ rules: { "huge.md": big } });
    const result = await runContextAudit({
      projectRoot: root,
      config: defaultConfig({
        budgetBytes: 1000,
        entryPointFiles: [],
      }),
    });
    expect(result.verdict).toBe("fail");
    expect(result.exitCode & 1).toBe(1); // size bit set
    expect(result.totalBytes).toBeGreaterThan(1000);
    expect(result.overBytes).toBeGreaterThan(0);
    const sizeSignal = result.signals.find((s) => s.id === "size");
    expect(sizeSignal?.status).toBe("fail");
  });

  it("returns PASS when entry-point file references an onDemandDirs path", async () => {
    const root = makeProject({
      rules: { "rule-a.md": "# A\n" },
      onDemand: { "ondemand-a.md": "# OD\n" },
      entryPoint: {
        name: "CLAUDE.md",
        content: "See [on-demand rules](./docs/ai-rules/README.md).\n",
      },
    });
    const result = await runContextAudit({
      projectRoot: root,
      config: defaultConfig(),
    });
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.entryPointSources).toContain("CLAUDE.md");
  });

  it("returns FAIL when no entry-point references onDemandDirs", async () => {
    const root = makeProject({
      rules: { "rule-a.md": "# A\n" },
      entryPoint: { name: "CLAUDE.md", content: "no link here\n" },
    });
    const result = await runContextAudit({
      projectRoot: root,
      config: defaultConfig(),
    });
    expect(result.verdict).toBe("fail");
    expect(result.exitCode & 4).toBe(4); // entry-point bit set
    const epSignal = result.signals.find((s) => s.id === "entry-point");
    expect(epSignal?.status).toBe("fail");
  });

  it("returns FAIL when a cross-reference points at a missing file", async () => {
    const root = makeProject({
      rules: {
        "with-deadlink.md": "see [missing](./.claude/rules/does-not-exist.md)\n",
      },
      onDemand: { "x.md": "# x\n" },
      entryPoint: {
        name: "CLAUDE.md",
        content: "[ondemand](./docs/ai-rules/x.md)\n",
      },
    });
    const result = await runContextAudit({
      projectRoot: root,
      config: defaultConfig(),
    });
    expect(result.verdict).toBe("fail");
    expect(result.exitCode & 2).toBe(2); // dead-link bit set
    const dl = result.signals.find((s) => s.id === "dead-link");
    expect(dl?.status).toBe("fail");
    expect(result.deadLinks.length).toBeGreaterThan(0);
  });
});

// ============================================================
// predictBudgetImpact — Write-target prediction
// ============================================================

describe("predictBudgetImpact", () => {
  it("returns wouldExceed=false / targetIsAutoLoad=false for non-autoLoad targets", async () => {
    const root = makeProject({});
    const result = await predictBudgetImpact({
      projectRoot: root,
      config: defaultConfig(),
      filePath: "src/random-file.ts",
      newContent: "x".repeat(100000),
    });
    expect(result.targetIsAutoLoad).toBe(false);
    expect(result.wouldExceed).toBe(false);
  });

  it("flags new auto-load file that pushes total over budgetBytes", async () => {
    const root = makeProject({ rules: { "existing.md": "x".repeat(30000) } });
    const result = await predictBudgetImpact({
      projectRoot: root,
      config: defaultConfig({ budgetBytes: 35000 }),
      filePath: ".claude/rules/new.md",
      newContent: "y".repeat(10000),
    });
    expect(result.targetIsAutoLoad).toBe(true);
    expect(result.wouldExceed).toBe(true);
    expect(result.marginBytes).toBeLessThan(0);
  });

  it("treats edits that strictly reduce size as wouldExceed=false", async () => {
    const root = makeProject({ rules: { "existing.md": "z".repeat(40000) } });
    const result = await predictBudgetImpact({
      projectRoot: root,
      config: defaultConfig({ budgetBytes: 35000 }),
      filePath: ".claude/rules/existing.md",
      newContent: "z".repeat(20000), // reducing
    });
    expect(result.targetIsAutoLoad).toBe(true);
    // Even though current is over budget, the edit *reduces* total — never warn.
    expect(result.wouldExceed).toBe(false);
  });
});
