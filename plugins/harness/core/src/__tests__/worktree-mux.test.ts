/**
 * core/src/__tests__/worktree-mux.test.ts
 *
 * Test plan for `harness worktree-mux`:
 *   1. auto + cmux available → uses cmux
 *   2. auto + cmux missing + tmux available → uses tmux
 *   3. auto + neither → degraded mode (no commands)
 *   4. --multiplexer=cmux + cmux missing → error with install hint
 *   5. --multiplexer=tmux + tmux missing → error with install hint
 *   6. empty worktree list → "No worktrees found"
 *   7. malformed porcelain block → warning + skip, valid blocks still parsed
 *   8. --with-claude → claude command embedded in each pane
 *   9. parsePorcelain unit: standard multi-block format
 *  10. runPlan dispatches commands in order
 */

import { describe, it, expect, vi } from "vitest";
import {
  planWorktreeMux,
  runPlan,
  parsePorcelain,
} from "../worktree-mux.js";

const SAMPLE_PORCELAIN = [
  "worktree /path/to/project",
  "HEAD abc123",
  "branch refs/heads/main",
  "",
  "worktree /path/to/project-wt-feature-a",
  "HEAD def456",
  "branch refs/heads/feature/feature-a",
].join("\n");

const SINGLE_WORKTREE = [
  "worktree /path/to/project",
  "HEAD abc123",
  "branch refs/heads/main",
].join("\n");

describe("planWorktreeMux", () => {
  it("case 1: auto + cmux available → uses cmux", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "cmux",
    });
    expect(plan.success).toBe(true);
    expect(plan.multiplexerUsed).toBe("cmux");
    expect(plan.worktrees).toEqual([
      "/path/to/project",
      "/path/to/project-wt-feature-a",
    ]);
    expect(plan.commands).toHaveLength(2);
    for (const c of plan.commands) {
      expect(c).toMatch(/^cmux open --column/);
    }
  });

  it("case 2: auto + cmux missing + tmux available → uses tmux", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "tmux",
    });
    expect(plan.multiplexerUsed).toBe("tmux");
    // tmux plan prefixes a defensive `kill-session ... || true` so reruns
    // don't fail with a duplicate-session error.
    expect(plan.commands[0]).toMatch(/tmux kill-session.*\|\| true/);
    expect(plan.commands[1]).toMatch(/tmux new-session/);
    expect(plan.commands[2]).toMatch(/tmux split-window/);
  });

  it("case 3: auto + neither → degraded mode", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: () => false,
    });
    expect(plan.success).toBe(true);
    expect(plan.multiplexerUsed).toBe("degraded");
    expect(plan.commands).toEqual([]);
    expect(plan.worktrees).toHaveLength(2);
  });

  it("case 4: --multiplexer=cmux + cmux missing → error", () => {
    const plan = planWorktreeMux({
      multiplexer: "cmux",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: () => false,
    });
    expect(plan.success).toBe(false);
    expect(plan.error).toMatch(/cmux not found/);
    expect(plan.error).toMatch(/cmux\.com/);
  });

  it("case 5: --multiplexer=tmux + tmux missing → error", () => {
    const plan = planWorktreeMux({
      multiplexer: "tmux",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: () => false,
    });
    expect(plan.success).toBe(false);
    expect(plan.error).toMatch(/tmux not found/);
    expect(plan.error).toMatch(/brew install tmux/);
  });

  it("case 6: empty worktree list → 'No worktrees found'", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => "",
      commandDetector: (cmd) => cmd === "tmux",
    });
    expect(plan.success).toBe(true);
    expect(plan.error).toBe("No worktrees found");
    expect(plan.commands).toEqual([]);
  });

  it("case 7: malformed porcelain block → warn + skip", () => {
    const malformed = ["junk-line-without-prefix", "", SINGLE_WORKTREE].join("\n");
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => malformed,
      commandDetector: (cmd) => cmd === "tmux",
    });
    expect(plan.worktrees).toEqual(["/path/to/project"]);
    expect(plan.warnings.some((w) => w.includes("malformed"))).toBe(true);
  });

  it("case 8: --with-claude → claude embedded in each pane command", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: true,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "tmux",
    });
    // Pane-creating commands (`new-session` / `split-window`) must each
    // embed `claude`. The defensive `kill-session` guard never carries
    // claude — it just clears any leftover session before the panes are
    // recreated.
    const paneCommands = plan.commands.filter(
      (c) => !c.startsWith("tmux kill-session"),
    );
    expect(paneCommands.length).toBeGreaterThan(0);
    for (const c of paneCommands) {
      expect(c).toMatch(/claude/);
    }
  });

  it("case 8b: cmux + --with-claude → claude embedded", () => {
    const plan = planWorktreeMux({
      multiplexer: "cmux",
      withClaude: true,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "cmux",
    });
    for (const c of plan.commands) {
      expect(c).toMatch(/claude/);
    }
  });
});

describe("parsePorcelain", () => {
  it("case 9: parses standard multi-block format", () => {
    const result = parsePorcelain(SAMPLE_PORCELAIN);
    expect(result.worktrees).toEqual([
      "/path/to/project",
      "/path/to/project-wt-feature-a",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("ignores trailing whitespace blocks", () => {
    const result = parsePorcelain(SAMPLE_PORCELAIN + "\n\n\n");
    expect(result.worktrees).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("warns on blocks that do not start with `worktree`", () => {
    const result = parsePorcelain("HEAD abc\nbranch refs/heads/main");
    expect(result.worktrees).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("handles mixed valid + malformed blocks", () => {
    const mixed = [
      "worktree /path/to/project",
      "HEAD abc123",
      "",
      "junk-without-prefix",
      "",
      "worktree /path/to/project-wt-feature-b",
      "HEAD ghi789",
    ].join("\n");
    const result = parsePorcelain(mixed);
    expect(result.worktrees).toEqual([
      "/path/to/project",
      "/path/to/project-wt-feature-b",
    ]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("runPlan", () => {
  it("case 10: dispatches commands in order, returns 0 on success", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "tmux",
    });
    const executed: string[] = [];
    const out = vi.fn();
    const warn = vi.fn();
    const code = runPlan(plan, out, warn, (cmd) => {
      executed.push(cmd);
    });
    expect(code).toBe(0);
    expect(executed).toHaveLength(plan.commands.length);
    // The first executed command is the idempotent kill-session guard,
    // followed by new-session, split-window, ...
    expect(executed[0]).toMatch(/tmux kill-session/);
    expect(executed[1]).toMatch(/tmux new-session/);
  });

  it("returns 0 and prints worktrees for degraded plan", () => {
    const plan = planWorktreeMux({
      multiplexer: "auto",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: () => false,
    });
    const messages: string[] = [];
    const warnings: string[] = [];
    const code = runPlan(plan, (m) => messages.push(m), (m) => warnings.push(m), () => {
      throw new Error("should not execute commands in degraded mode");
    });
    expect(code).toBe(0);
    expect(messages.some((m) => m.includes("/path/to/project"))).toBe(true);
    expect(warnings.some((w) => w.includes("cmux"))).toBe(true);
    expect(warnings.some((w) => w.includes("tmux"))).toBe(true);
  });

  it("returns non-zero for an unsuccessful plan", () => {
    const plan = planWorktreeMux({
      multiplexer: "cmux",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: () => false,
    });
    const warn = vi.fn();
    const code = runPlan(plan, () => undefined, warn, () => undefined);
    expect(code).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it("returns non-zero when command execution throws", () => {
    const plan = planWorktreeMux({
      multiplexer: "tmux",
      withClaude: false,
      worktreeListSource: () => SAMPLE_PORCELAIN,
      commandDetector: (cmd) => cmd === "tmux",
    });
    const warn = vi.fn();
    let calls = 0;
    const code = runPlan(plan, () => undefined, warn, () => {
      calls++;
      throw new Error("simulated failure");
    });
    expect(code).toBe(1);
    expect(calls).toBe(1);
  });
});
