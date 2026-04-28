/**
 * core/src/__tests__/context-audit-stop-hook.test.ts
 *
 * Verifies that the Stop hook composes the context-budget audit when
 * `harness.config.json.contextBudget.enabled === true`. Backward-compat:
 * when `contextBudget.enabled` is unset or false, the legacy reminder set
 * (TDD / Pseudo CR / Real CR / Codex) is unchanged.
 *
 * Note: the `stop_hook_active === true` short-circuit is exercised by
 * `hooks.test.ts`; we focus on the new context-budget code path here.
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

import { handleStop } from "../hooks/stop.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeProject(harnessConfig?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-stop-ctxbudget-"));
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

describe("Stop hook — backward compat (contextBudget absent / disabled)", () => {
  it("contextBudget absent → no context-audit reminder injected", async () => {
    const root = makeProject({});
    const result = await handleStop({
      hook_event_name: "Stop",
      cwd: root,
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toContain("context budget");
    expect(result.additionalContext ?? "").not.toContain("contextBudget");
  });

  it("contextBudget.enabled=false → no context-audit reminder", async () => {
    const root = makeProject({ contextBudget: { enabled: false } });
    const result = await handleStop({
      hook_event_name: "Stop",
      cwd: root,
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toContain("context budget");
  });
});

describe("Stop hook — context-audit reminder when enabled + FAIL", () => {
  it("contextBudget.enabled=true + audit FAIL (over budget) → warning injected", async () => {
    const root = makeProject({ contextBudget: { enabled: true, budgetBytes: 1000 } });
    // populate `.claude/rules/` with > 1 000 bytes so size gate FAILs
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude/rules", "huge.md"),
      "x".repeat(2000),
      "utf-8",
    );

    const result = await handleStop({
      hook_event_name: "Stop",
      cwd: root,
    });
    expect(result.decision).toBe("approve");
    // The warning marker is part of the new contract — we anchor on a stable
    // substring rather than the full sentence so future tweaks don't break.
    expect(result.additionalContext ?? "").toMatch(/context.?budget/i);
    expect(result.additionalContext ?? "").toMatch(/FAIL|over/i);
  });

  it("contextBudget.enabled=true + audit PASS → no context-budget marker", async () => {
    const root = makeProject({
      contextBudget: { enabled: true, entryPointFiles: [] },
    });
    // empty `.claude/rules/` ⇒ size PASS, dead-link PASS, entry-point SKIP
    const result = await handleStop({
      hook_event_name: "Stop",
      cwd: root,
    });
    expect(result.decision).toBe("approve");
    expect(result.additionalContext ?? "").not.toMatch(
      /context.?budget.+(FAIL|over)/i,
    );
  });
});
