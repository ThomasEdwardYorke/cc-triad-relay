/**
 * Commands handoff-awareness footer integration test
 *
 * Verifies that all commands files referencing legacy `Plans.md` ship the
 * unified handoff-mode awareness footer at the bottom. The footer tells
 * handoff-mode consumers how to translate `Plans.md` mentions in the spec
 * body into their 4-layer dispatch files (backlog / current / decisions /
 * roadmap).
 *
 * Rationale: detail-updating each in-body `Plans.md` mention (~97 across
 * 10 files) would degrade readability without proportional payoff. A
 * single trailing footer per file gives handoff-mode users a stable
 * read-and-translate anchor while keeping the spec compact.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const commandsDir = path.resolve(__dirname, "../../../commands");
// session-handoff.md is exempt: it is the handoff-doc skill itself, so the
// awareness translation is already part of the spec body. Adding the footer
// would also push the file past the Anthropic SKILL.md 500-line hard limit
// enforced by content-integrity.test.ts.
const FILES_WITH_PLANS_REF = [
  "harness-work.md",
  "harness-plan.md",
  "parallel-worktree.md",
  "harness-review.md",
  "tdd-implement.md",
  "harness-setup.md",
  "clarify.md",
  "parallel-worktree-v2.md",
  "harness-merge-train.md",
];

describe("commands handoff-mode awareness footer", () => {
  for (const filename of FILES_WITH_PLANS_REF) {
    it(`${filename} ships the handoff awareness footer`, () => {
      const filePath = path.join(commandsDir, filename);
      const content = fs.readFileSync(filePath, "utf-8");

      // Header presence
      expect(content).toContain("Handoff-mode Awareness Note");

      // 4-layer dispatch — key contract (handoffPaths.<key>), not fixed
      // file paths. Consumers may override the path values via
      // `harness.config.json.work.handoffPaths`, so the footer must talk
      // in terms of the schema keys to remain valid under custom paths.
      expect(content).toContain("handoffPaths.backlog");
      expect(content).toContain("handoffPaths.current");
      expect(content).toContain("handoffPaths.roadmap");
      expect(content).toContain("handoffPaths.decisions");

      // History.md is the canonical legacy alias for the completion log,
      // referenced by name (not via handoffPaths).
      expect(content).toContain("History.md");

      // Schema cross-reference (canonical key list, sourced from
      // HANDOFF_PATH_KEYS in config.ts).
      expect(content).toContain("HANDOFF_PATH_KEYS");

      // Footer ships the read-and-translate design rationale.
      expect(content).toContain("read-and-translate");
    });
  }

  it("footer is appended at the bottom (not the top)", () => {
    // Sample one representative file: footer is the trailing section,
    // not embedded in the spec body. Future contributors must keep this
    // invariant — moving the footer up would put translation guidance
    // before the spec it modifies.
    const filePath = path.join(commandsDir, "harness-work.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const footerIndex = content.indexOf("Handoff-mode Awareness Note");
    const lastSectionMarkerIndex = content.lastIndexOf("\n## ");
    // footer's "## Handoff-mode Awareness Note" should be the last "## "
    // heading in the file
    expect(lastSectionMarkerIndex).toBeGreaterThan(0);
    expect(content.slice(lastSectionMarkerIndex)).toContain(
      "Handoff-mode Awareness Note",
    );
    expect(footerIndex).toBeGreaterThan(lastSectionMarkerIndex - 100);
  });
});
