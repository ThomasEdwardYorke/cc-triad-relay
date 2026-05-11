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

  const next = content.indexOf("\n## ", start + heading.length);
  return next === -1 ? content.slice(start) : content.slice(start, next);
}

describe("remote branch cleanup audit", () => {
  it("records the 2026-05-12 cleanup decision for historical remote branches", () => {
    const doc = readRepoFile("docs/maintainer/development-branching.md");
    const section = extractSection(doc, "## Remote Branch Cleanup Audit");

    expect(section).toContain("2026-05-12");
    expect(section).toContain("feature/model-b-evolution");
    expect(section).toContain("51df84a");
    expect(section).toContain("PR #17");
    expect(section).toContain("closed without merge");
    expect(section).toContain("retain");
    expect(section).toContain("feature/model-registry");
    expect(section).toContain("f5d43a1");
    expect(section).toContain("9 unique commits");
    expect(section).toContain("not deleted");
  });

  it("keeps remote deletion gated on PR and merge-containment checks", () => {
    const doc = readRepoFile("docs/maintainer/development-branching.md");
    const section = extractSection(doc, "## Cleanup");

    expect(section).toContain("open PR");
    expect(section).toContain("closed-but-unmerged PR");
    expect(section).toContain("branch head");
    expect(section).toContain("contained in `origin/dev`");
    expect(section).toContain("contained in `origin/main`");
    expect(section).toContain("release dependency");
  });
});
