/**
 * core/src/work/__tests__/ledger.test.ts
 *
 * TDD tests for the consumer-side discipline ledger writer
 * (`appendDisciplineEntry`). The writer appends Markdown table rows to
 * a project-relative ledger file declared via
 * `harness.config.json` → `work.qualityGates.disciplineLedgerPath`.
 *
 * Cross-process atomicity is a POSIX `write(2)` / `O_APPEND` invariant
 * for payloads under `PIPE_BUF` (≥ 4096 B on Linux/macOS). The
 * 50-parallel race test below uses `Promise.all` over the synchronous
 * `fs.appendFileSync` API, which is serialised by Node.js's event loop
 * — that proves entries do not interleave **within the same process**
 * (the harness's intended workload). Asserting the actual cross-process
 * invariant would require `child_process.fork` and is out of scope for
 * this unit test; see `ledger.ts` for the architectural rationale.
 *
 * Path validation rejects absolute paths and any segment that escapes
 * the project root so the writer cannot leave the sandbox.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, type HarnessConfig } from "../../config.js";
import { appendDisciplineEntry, type DisciplineEntry } from "../ledger.js";

function mkTmp(): string {
  const root = join(
    tmpdir(),
    `ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function makeConfig(ledgerPath: string | undefined): HarnessConfig {
  return {
    ...DEFAULT_CONFIG,
    work: {
      ...DEFAULT_CONFIG.work,
      qualityGates: {
        ...DEFAULT_CONFIG.work.qualityGates,
        disciplineLedgerPath: ledgerPath,
      },
    },
  };
}

const sampleEntry: DisciplineEntry = {
  date: "2026-04-26",
  session: "harness-model-b/test",
  skillId: "G2",
  impact: "stop hook quality-gate reminder skipped",
  remediation: "next session route via /harness-work",
};

describe("appendDisciplineEntry", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkTmp();
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe("config wiring", () => {
    it("returns no-op-no-config when disciplineLedgerPath is unset", () => {
      const config = makeConfig(undefined);
      const result = appendDisciplineEntry(config, tmpRoot, sampleEntry);
      expect(result.status).toBe("no-op-no-config");
    });

    it("does not create a file when disciplineLedgerPath is unset", () => {
      const config = makeConfig(undefined);
      appendDisciplineEntry(config, tmpRoot, sampleEntry);
      expect(existsSync(join(tmpRoot, ".harness/discipline-ledger.md"))).toBe(
        false,
      );
    });

    it("returns no-op-no-config when disciplineLedgerPath is the empty string", () => {
      const config = makeConfig("");
      const result = appendDisciplineEntry(config, tmpRoot, sampleEntry);
      expect(result.status).toBe("no-op-no-config");
    });
  });

  describe("path validation", () => {
    it("rejects absolute paths", () => {
      const config = makeConfig("/etc/passwd");
      expect(() =>
        appendDisciplineEntry(config, tmpRoot, sampleEntry),
      ).toThrow(/absolute/i);
    });

    it("rejects parent traversal segments", () => {
      const config = makeConfig("../../../etc/passwd");
      expect(() =>
        appendDisciplineEntry(config, tmpRoot, sampleEntry),
      ).toThrow(/parent|escape/i);
    });

    it("rejects paths that resolve outside projectRoot via dot segments", () => {
      const config = makeConfig("subdir/../../escape.md");
      expect(() =>
        appendDisciplineEntry(config, tmpRoot, sampleEntry),
      ).toThrow(/parent|escape/i);
    });

    it("rejects empty segments after normalisation (e.g. //)", () => {
      // `//foo` after normalisation looks absolute on POSIX. We reject it
      // explicitly so the writer never opens a file outside the sandbox.
      const config = makeConfig("//etc/passwd");
      expect(() =>
        appendDisciplineEntry(config, tmpRoot, sampleEntry),
      ).toThrow(/absolute|parent|escape/i);
    });

    it("requires projectRoot to be an absolute path", () => {
      const config = makeConfig("ledger.md");
      expect(() =>
        appendDisciplineEntry(config, "relative/project", sampleEntry),
      ).toThrow(/projectRoot/i);
    });
  });

  describe("file creation + append", () => {
    it("creates a new ledger file with header + first entry", () => {
      const ledgerRel = ".harness/discipline-ledger.md";
      const config = makeConfig(ledgerRel);
      const result = appendDisciplineEntry(config, tmpRoot, sampleEntry);

      expect(result.status).toBe("appended");
      const ledgerAbs = join(tmpRoot, ledgerRel);
      expect(result.ledgerPath).toBe(ledgerAbs);

      const content = readFileSync(ledgerAbs, "utf-8");
      expect(content).toMatch(/^# /m); // header heading
      expect(content).toMatch(
        /\| Date \| Session \| Skill \| Impact \| Remediation \|/,
      );
      expect(content).toContain(
        "| 2026-04-26 | harness-model-b/test | G2 |",
      );
    });

    it("appends to an existing ledger without duplicating the header", () => {
      const ledgerRel = ".harness/discipline-ledger.md";
      const config = makeConfig(ledgerRel);

      appendDisciplineEntry(config, tmpRoot, sampleEntry);
      appendDisciplineEntry(config, tmpRoot, {
        ...sampleEntry,
        skillId: "G5",
        impact: "pseudo CR skipped",
      });

      const content = readFileSync(join(tmpRoot, ledgerRel), "utf-8");
      const headerMatches = content.match(/^# /gm) ?? [];
      expect(headerMatches.length).toBe(1);
      expect(content).toContain("| G2 |");
      expect(content).toContain("| G5 |");
      // Each entry occupies exactly one line — no accidental newline
      // duplication
      const rowLines = content
        .split("\n")
        .filter((l) => l.startsWith("| 2026-04-26 |"));
      expect(rowLines.length).toBe(2);
    });

    it("creates intermediate parent directories when missing", () => {
      const ledgerRel = ".harness/nested/deep/discipline.md";
      const config = makeConfig(ledgerRel);
      const result = appendDisciplineEntry(config, tmpRoot, sampleEntry);
      expect(result.status).toBe("appended");
      expect(existsSync(join(tmpRoot, ledgerRel))).toBe(true);
    });

    it("returns the resolved absolute ledger path", () => {
      const ledgerRel = "discipline.md";
      const config = makeConfig(ledgerRel);
      const result = appendDisciplineEntry(config, tmpRoot, sampleEntry);
      expect(result.ledgerPath).toBe(join(tmpRoot, ledgerRel));
    });
  });

  describe("entry escaping", () => {
    it("escapes pipe `|` characters so they do not break the markdown table", () => {
      const ledgerRel = "discipline.md";
      const config = makeConfig(ledgerRel);
      appendDisciplineEntry(config, tmpRoot, {
        ...sampleEntry,
        impact: "command `gh pr view | jq .state` failed",
      });
      const content = readFileSync(join(tmpRoot, ledgerRel), "utf-8");
      // Each row must have exactly 6 unescaped pipes (5 columns ⇒
      // leading + 4 separators + trailing = 6).
      const lastRow = content.trim().split("\n").at(-1) ?? "";
      const unescapedPipes =
        lastRow.replace(/\\\|/g, "").split("|").length - 1;
      expect(unescapedPipes).toBe(6);
      expect(lastRow).toContain("\\|");
    });

    it("collapses newlines inside an entry to single spaces", () => {
      const ledgerRel = "discipline.md";
      const config = makeConfig(ledgerRel);
      appendDisciplineEntry(config, tmpRoot, {
        ...sampleEntry,
        impact: "first line\nsecond line",
      });
      const content = readFileSync(join(tmpRoot, ledgerRel), "utf-8");
      const lastRow = content.trim().split("\n").at(-1) ?? "";
      expect(lastRow).toMatch(/first line second line/);
      // Only one body row was written
      expect(content.match(/first line/g)?.length).toBe(1);
    });

    it("escapes carriage returns the same way as newlines", () => {
      const ledgerRel = "discipline.md";
      const config = makeConfig(ledgerRel);
      appendDisciplineEntry(config, tmpRoot, {
        ...sampleEntry,
        impact: "line-a\r\nline-b",
      });
      const content = readFileSync(join(tmpRoot, ledgerRel), "utf-8");
      const lastRow = content.trim().split("\n").at(-1) ?? "";
      // CR + LF are both collapsed to space, no literal CR remains
      expect(lastRow).not.toMatch(/\r/);
      expect(lastRow).toMatch(/line-a\s+line-b/);
    });
  });

  describe("concurrent append safety", () => {
    it("preserves every entry when 50 appends run in parallel", async () => {
      const ledgerRel = "discipline.md";
      const config = makeConfig(ledgerRel);
      const N = 50;
      // Seed once so the race is "open existing + append" — that path
      // is the one that actually exercises O_APPEND atomicity.
      appendDisciplineEntry(config, tmpRoot, sampleEntry);

      const tasks = Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() =>
          appendDisciplineEntry(config, tmpRoot, {
            ...sampleEntry,
            skillId: `G${i}`,
          }),
        ),
      );
      await Promise.all(tasks);

      const content = readFileSync(join(tmpRoot, ledgerRel), "utf-8");
      const rowMatches = content.match(/^\| 2026-04-26 \|/gm) ?? [];
      expect(rowMatches.length).toBe(1 + N);
      for (let i = 0; i < N; i++) {
        expect(content).toContain(`| G${i} |`);
      }
    });
  });
});
