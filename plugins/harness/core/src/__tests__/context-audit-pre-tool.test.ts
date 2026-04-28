/**
 * core/src/__tests__/context-audit-pre-tool.test.ts
 *
 * Verifies the PreToolUse hook augments existing guardrail evaluation with
 * a context-budget redirect suggestion when:
 *   - `contextBudget.enabled === true`
 *   - the Write target lives under any `autoLoadDirs/`
 *   - the predicted post-write total exceeds `budgetBytes`
 *
 * The hook NEVER blocks (decision stays `approve` for the new code path).
 * Existing deny / ask paths from the rules engine are passed through
 * untouched (verified separately in `rules.test.ts`).
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

import { evaluatePreTool } from "../guardrails/pre-tool.js";
import type { HookInput } from "../types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeProject(harnessConfig?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-pretool-ctxbudget-"));
  tempDirs.push(dir);
  if (harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(harnessConfig),
      "utf-8",
    );
  }
  return dir;
}

function callWrite(
  cwd: string,
  filePath: string,
  content: string,
): Promise<ReturnType<typeof evaluatePreTool>> | ReturnType<typeof evaluatePreTool> {
  const input: HookInput = {
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
    cwd,
  };
  return evaluatePreTool(input);
}

describe("PreToolUse — backward compat (contextBudget absent / disabled)", () => {
  it("contextBudget absent → no redirect suggestion (legacy behaviour preserved)", async () => {
    const root = makeProject({});
    const result = await callWrite(
      root,
      ".claude/rules/foo.md",
      "x".repeat(60000),
    );
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toMatch(/redirect|onDemand/i);
  });

  it("contextBudget.enabled=false → no redirect suggestion", async () => {
    const root = makeProject({ contextBudget: { enabled: false } });
    const result = await callWrite(
      root,
      ".claude/rules/foo.md",
      "x".repeat(60000),
    );
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toMatch(/redirect|onDemand/i);
  });
});

describe("PreToolUse — context-budget redirect suggestion", () => {
  it("Write to autoLoadDirs target that pushes over budget → warning injected", async () => {
    const root = makeProject({
      contextBudget: {
        enabled: true,
        budgetBytes: 5000,
      },
    });
    // existing rules already push close to the budget
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude/rules/existing.md"),
      "y".repeat(4000),
      "utf-8",
    );

    const result = await callWrite(
      root,
      ".claude/rules/new-rule.md",
      "z".repeat(3000),
    );
    expect(result.decision).toBe("approve");
    // The warning surfaces both the auto-load directory and an onDemandDirs
    // redirect suggestion so Claude has actionable next-step guidance.
    expect(result.additionalContext ?? "").toMatch(/context.?budget/i);
    expect(result.additionalContext ?? "").toMatch(/onDemand|on-demand|redirect/i);
  });

  it("Write to file outside autoLoadDirs → no warning", async () => {
    const root = makeProject({ contextBudget: { enabled: true, budgetBytes: 100 } });
    // `src/foo.ts` is not under any autoLoadDirs entry
    const result = await callWrite(root, "src/foo.ts", "x".repeat(20000));
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toMatch(/redirect|onDemand/i);
  });

  it("Edit-style overwrite that *reduces* size → no warning (skip optimisation)", async () => {
    const root = makeProject({ contextBudget: { enabled: true, budgetBytes: 5000 } });
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude/rules/existing.md"),
      "x".repeat(10000), // already over budget
      "utf-8",
    );
    const result = await callWrite(
      root,
      ".claude/rules/existing.md",
      "x".repeat(2000), // reducing
    );
    expect(result.decision).toBe("approve");
    // Reducing-size edit is a strict improvement — no warning.
    expect(result.additionalContext ?? "").not.toMatch(
      /redirect|onDemand|on-demand/i,
    );
  });

  it("non-Write tool (Bash) → context-budget hook is a no-op", async () => {
    const root = makeProject({ contextBudget: { enabled: true } });
    const input: HookInput = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: root,
    };
    const result = await evaluatePreTool(input);
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toMatch(/redirect|onDemand/i);
  });
});
