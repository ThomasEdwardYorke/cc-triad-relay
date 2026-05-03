/**
 * PR #82 — template default = handoff mode integration test
 *
 * Verifies that:
 * 1. `template/.claude/harness.config.json.tmpl` ships with handoff mode default
 *    (`taskTrackerMode = "handoff"` + populated `handoffPaths` 4 keys)
 * 2. `template/.docs/handoff/` ships 4 sample tmpl files matching handoff
 *    schema field names (current / backlog / decisions / roadmap)
 * 3. `template/History.md.tmpl` ships handoff mode-aware history doc
 * 4. `DEFAULT_CONFIG.work.taskTrackerMode` stays `"plans"` for backward
 *    compatibility (template default vs in-memory default split — see
 *    config.ts L902-908 comment for rationale)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CONFIG } from "../config.js";

const templateRoot = path.resolve(__dirname, "../../../../../template");
const HANDOFF_PATH_KEYS = ["backlog", "current", "decisions", "roadmap"] as const;

describe("PR #82: template default = handoff mode", () => {
  it("template/.claude/harness.config.json.tmpl ships with handoff mode default", () => {
    const tmplPath = path.join(templateRoot, ".claude/harness.config.json.tmpl");
    expect(fs.existsSync(tmplPath)).toBe(true);

    const content = fs.readFileSync(tmplPath, "utf-8");
    const cfg = JSON.parse(content);

    expect(cfg.work).toBeDefined();
    expect(cfg.work.taskTrackerMode).toBe("handoff");
    expect(cfg.work.handoffPaths).toBeDefined();

    const keys = Object.keys(cfg.work.handoffPaths).sort();
    expect(keys).toEqual([...HANDOFF_PATH_KEYS].sort());

    // each value should be a non-empty string project-relative path
    for (const key of HANDOFF_PATH_KEYS) {
      const value = cfg.work.handoffPaths[key];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
      expect(value).not.toMatch(/^\//); // not absolute
      expect(value).not.toContain(".."); // no parent traversal
    }
  });

  it("template/.docs/handoff/ ships 4 sample tmpl files matching schema field names", () => {
    const handoffDir = path.join(templateRoot, ".docs/handoff");
    expect(fs.existsSync(handoffDir)).toBe(true);

    const files = fs.readdirSync(handoffDir);
    for (const key of HANDOFF_PATH_KEYS) {
      const expectedFile = `PROJECT_NAME-${key}.md.tmpl`;
      expect(files).toContain(expectedFile);
    }
  });

  it("template/History.md.tmpl ships handoff mode-aware history doc", () => {
    const histPath = path.join(templateRoot, "History.md.tmpl");
    expect(fs.existsSync(histPath)).toBe(true);

    const content = fs.readFileSync(histPath, "utf-8");
    expect(content).toContain("handoff mode default project");
    expect(content).toContain("{{PROJECT_NAME}}");
    // role pivot prevention: must explicitly forbid active task append
    expect(content).toContain("active task 追記は禁止");
  });

  it("DEFAULT_CONFIG.work.taskTrackerMode stays 'plans' for backward compat", () => {
    // Template default (handoff) ≠ in-memory default (plans) by design.
    // Switching DEFAULT_CONFIG to "handoff" would silently regress
    // consumers that omit `handoffPaths` (they'd fall back to plans
    // through a stderr WARN that CI logs typically swallow).
    expect(DEFAULT_CONFIG.work.taskTrackerMode).toBe("plans");
    expect(DEFAULT_CONFIG.work.handoffPaths).toBeUndefined();
  });

  it("config.ts ships explanatory comment about template default vs in-memory default", () => {
    const configPath = path.resolve(__dirname, "../config.ts");
    const content = fs.readFileSync(configPath, "utf-8");
    // Per Codex Phase 4 risk #5: comment must document why DEFAULT_CONFIG
    // stays "plans" while template ships "handoff" (silent regression
    // prevention).
    expect(content).toContain("silent");
    expect(content).toContain("template default");
  });
});
