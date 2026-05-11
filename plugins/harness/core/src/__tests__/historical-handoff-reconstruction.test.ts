import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf-8");
}

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start === -1) {
    throw new Error(`Heading not found: ${heading}`);
  }

  const next = content.indexOf("\n### ", start + heading.length);
  return next === -1 ? content.slice(start) : content.slice(start, next);
}

describe("historical harness snapshot reconstruction", () => {
  it("records the predecessor Plans snapshot triage in maintainer docs", () => {
    const usage = readRepoFile("docs/maintainer/test-bed-usage.md");
    const section = extractSection(
      usage,
      "### 2026-05-12 — Historical Plans snapshot reconstruction",
    );

    expect(section).toContain("`.docs/claude-code-harness-main/Plans.md`");
    expect(section).toContain("`.docs/claude-code-harness-main 2/Plans.md`");
    expect(section).toContain("repo-root `Plans.md`");
    expect(section).toContain("Rejected historical items");
    expect(section).toContain("v3 full rewrite");
    expect(section).toContain("Phase 25");
    expect(section).toContain("Phase 26");
    expect(section).toContain("prompt-generation backlog is business-specific");
    expect(section).toContain("Retained actionable maintainer work");
    expect(section).toContain("release PR");
    expect(section).toContain("remote branch cleanup");
    expect(section).toContain("Model B dogfood");
    expect(section).toContain("Decision**: `generalize-next`");
  });

  it("keeps reconstructed evidence sanitized and outside live handoff state", () => {
    const usage = readRepoFile("docs/maintainer/test-bed-usage.md");
    const section = extractSection(
      usage,
      "### 2026-05-12 — Historical Plans snapshot reconstruction",
    );

    expect(section).not.toContain("/Users/");
    expect(section).not.toContain("feature/improve-script-prompt");
    expect(section).not.toContain("make_short_script_class.py");
    expect(section).toContain("ignored `.docs/handoff/`");
  });

  it("marks the old model-b branch instructions as historical in the roadmap", () => {
    const roadmap = readRepoFile("docs/maintainer/ROADMAP-model-b.md");

    expect(roadmap).toContain("Status as of 2026-05-12");
    expect(roadmap).toMatch(
      /Do not start\s+new work from `feature\/model-b-evolution`/,
    );
    expect(roadmap).toMatch(
      /normal work starts from `dev` on a\s+short-lived `feature\/\*` branch/,
    );
  });
});
