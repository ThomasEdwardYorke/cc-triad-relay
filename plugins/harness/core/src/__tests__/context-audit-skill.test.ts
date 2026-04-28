/**
 * core/src/__tests__/context-audit-skill.test.ts
 *
 * Verifies the skill / agent / script artefacts that the Stop and PreToolUse
 * hooks compose against. The artefacts must:
 *   - exist at their canonical plugin paths
 *   - declare the correct frontmatter `name`
 *   - stay within Anthropic's recommended SKILL.md size envelope (≤ 500 lines)
 *   - avoid `parts-management`-specific literals (the script must be generic)
 *
 * Source of the SKILL.md size guidance:
 *   https://code.claude.com/docs/en/skills (focused-principle, supporting files)
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// `__tests__/` lives at `core/src/__tests__/`. Plugin root is three levels up.
const pluginRoot = resolve(__dirname, "../../..");

const SKILL_PATH = join(pluginRoot, "commands/context-audit.md");
const AGENT_PATH = join(pluginRoot, "agents/context-audit-agent.md");
const SCRIPT_PATH = join(pluginRoot, "scripts/context-audit.sh");

describe("context-audit skill artefact", () => {
  it("exists at the canonical plugin path", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("declares `name: context-audit` in frontmatter", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body.startsWith("---")).toBe(true);
    expect(body).toMatch(/^name:\s*context-audit\s*$/m);
  });

  it("stays within Anthropic's SKILL.md size envelope (≤ 500 lines)", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    const lines = body.split(/\r?\n/);
    expect(lines.length).toBeLessThanOrEqual(500);
  });

  it("declares an `argument-hint` so callers know the supported flags", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toMatch(/^argument-hint:/m);
  });
});

describe("context-audit agent artefact", () => {
  it("exists at the canonical plugin path", () => {
    expect(existsSync(AGENT_PATH)).toBe(true);
  });

  it("declares `name: context-audit-agent` in frontmatter", () => {
    const body = readFileSync(AGENT_PATH, "utf-8");
    expect(body.startsWith("---")).toBe(true);
    expect(body).toMatch(/^name:\s*context-audit-agent\s*$/m);
  });
});

describe("context-audit generic script artefact", () => {
  it("exists at the canonical plugin path", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "is executable on POSIX (mode bit 0o111)",
    () => {
      // Windows file systems do not record Unix permission bits — git for
      // Windows preserves the executable flag in the index but not on the
      // checked-out file mode. The skill's runtime contract is "shell can
      // execute it on POSIX hosts"; CI matrices that include Windows skip
      // this assertion.
      const mode = statSync(SCRIPT_PATH).mode;
      expect((mode & 0o111) !== 0).toBe(true);
    },
  );

  it("does not embed `parts-management`-specific literals (must be generic)", () => {
    const body = readFileSync(SCRIPT_PATH, "utf-8");
    // The shipped harness script must be project-neutral. parts-management's
    // own audit script lives at `parts-management/scripts/audit/context-audit.sh`
    // and is allowed to reference literal directory names; the harness copy
    // pulls them from `harness.config.json.contextBudget`.
    expect(body).not.toMatch(/parts-management/i);
  });

  it("declares the bit-OR exit-code precedent in a comment block", () => {
    const body = readFileSync(SCRIPT_PATH, "utf-8");
    expect(body).toMatch(/exit code/i);
    // The four canonical exit codes (0 / 1 / 2 / 4) must be visible so that
    // shell consumers writing `if [ $? -eq 4 ]` know what to expect.
    expect(body).toMatch(/0\s*PASS/i);
    expect(body).toMatch(/\b1\b/);
    expect(body).toMatch(/\b2\b/);
    expect(body).toMatch(/\b4\b/);
  });
});
