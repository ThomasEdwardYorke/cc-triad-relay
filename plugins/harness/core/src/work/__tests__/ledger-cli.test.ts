/**
 * core/src/work/__tests__/ledger-cli.test.ts
 *
 * Tests for the discipline-ledger shell wrapper. The wrapper is the
 * entrypoint shell scripts (`/harness-merge-train` fail-fast path,
 * future skills) call to register a violation without re-implementing
 * markdown formatting or path validation.
 *
 * Public surface under test (`runLedgerCli`) is a pure function so
 * `process.exit` / argv parsing can be exercised without forking a
 * child process. The thin `bin/`-style entrypoint at the bottom of
 * `ledger-cli.ts` simply forwards `process.argv` and writes to the
 * real stdout/stderr.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLedgerCli } from "../ledger-cli.js";

function mkProject(ledgerRel: string | undefined): string {
  const root = join(
    tmpdir(),
    `ledger-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  if (ledgerRel !== undefined) {
    const cfg = {
      work: {
        qualityGates: {
          disciplineLedgerPath: ledgerRel,
        },
      },
    };
    writeFileSync(join(root, "harness.config.json"), JSON.stringify(cfg));
  }
  return root;
}

interface CapturedIo {
  stdout: string[];
  stderr: string[];
}

function captureIo(): CapturedIo & {
  out: (s: string) => void;
  err: (s: string) => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (s: string) => stdout.push(s),
    err: (s: string) => stderr.push(s),
  };
}

describe("runLedgerCli", () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe("argv parsing", () => {
    it("returns exit code 2 + usage on missing subcommand", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli([], {
        cwd: tmpRoot,
        stdout: io.out,
        stderr: io.err,
      });
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/usage|append/i);
    });

    it("returns exit code 2 + usage on unknown subcommand", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(["bogus"], {
        cwd: tmpRoot,
        stdout: io.out,
        stderr: io.err,
      });
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/unknown|append/i);
    });

    it("returns exit code 2 when a required flag is missing", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        ["append", "--skill", "G2"],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/--impact|--session|--remediation/);
    });

    it("returns exit code 2 when a flag is missing its value", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "x",
          "--remediation",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/--remediation/);
    });
  });

  describe("flag forms", () => {
    it("accepts the `--key=value` form on every flag", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session=harness/test",
          "--skill=G2",
          "--impact=eq form smoke",
          "--remediation=verify",
          "--date=2026-04-26",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      const content = readFileSync(
        join(tmpRoot, ".harness/ledger.md"),
        "utf-8",
      );
      expect(content).toContain(
        "| 2026-04-26 | harness/test | G2 |",
      );
    });

    it("treats `--key=` (empty RHS) as a missing value (exit 2)", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session=",
          "--skill=G2",
          "--impact=x",
          "--remediation=y",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/--session/);
    });

    it("rejects unknown `--key=value` flag the same way as space form", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        ["append", "--bogus=hi"],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(/unknown flag --bogus/);
    });

    it("accepts a mix of `--key value` and `--key=value` in one invocation", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session=mixed",
          "--skill",
          "G7",
          "--impact=mixed-form smoke",
          "--remediation",
          "verify",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      const content = readFileSync(
        join(tmpRoot, ".harness/ledger.md"),
        "utf-8",
      );
      expect(content).toContain("| mixed | G7 | mixed-form smoke |");
    });
  });

  describe("happy path", () => {
    it("writes a row + prints absolute ledger path on success (exit 0)", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "harness-model-b/test",
          "--skill",
          "G2",
          "--impact",
          "stop hook reminder skipped",
          "--remediation",
          "next session via /harness-work",
          "--date",
          "2026-04-26",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      const ledger = join(tmpRoot, ".harness/ledger.md");
      expect(io.stdout.join("\n")).toContain(ledger);
      const content = readFileSync(ledger, "utf-8");
      expect(content).toContain(
        "| 2026-04-26 | harness-model-b/test | G2 |",
      );
    });

    it("defaults --date to today (UTC YYYY-MM-DD) when omitted", () => {
      // Pin system time so the assertion never flakes on a UTC day
      // boundary (e.g. CI running at 23:59:59.x UTC where the test
      // body computes today = day-N but the CLI captures day-N+1).
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
        tmpRoot = mkProject(".harness/ledger.md");
        const io = captureIo();
        const code = runLedgerCli(
          [
            "append",
            "--session",
            "s",
            "--skill",
            "G3",
            "--impact",
            "x",
            "--remediation",
            "y",
          ],
          { cwd: tmpRoot, stdout: io.out, stderr: io.err },
        );
        expect(code).toBe(0);
        const content = readFileSync(
          join(tmpRoot, ".harness/ledger.md"),
          "utf-8",
        );
        expect(content).toContain(`| 2026-04-26 | s | G3 |`);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects relative --project-root with usage exit code (2)", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
          "--project-root",
          "relative/path",
        ],
        { cwd: "/", stdout: io.out, stderr: io.err },
      );
      // Usage error: caller passed a relative path, the CLI must
      // refuse before the runtime ledger writer is invoked.
      expect(code).toBe(2);
      expect(io.stderr.join("\n")).toMatch(
        /--project-root.*absolute|absolute.*--project-root/i,
      );
    });

    it("respects --project-root over cwd", () => {
      tmpRoot = mkProject(".harness/ledger.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G7",
          "--impact",
          "i",
          "--remediation",
          "r",
          "--project-root",
          tmpRoot,
        ],
        { cwd: "/", stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      expect(existsSync(join(tmpRoot, ".harness/ledger.md"))).toBe(true);
    });
  });

  describe("config / no-op", () => {
    it("exits 0 with a stdout no-op marker when the path is unconfigured", () => {
      tmpRoot = mkProject(undefined); // no harness.config.json
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      const out = io.stdout.join("\n");
      expect(out).toMatch(/no-op/i);
      // No file was created
      expect(existsSync(join(tmpRoot, ".harness/ledger.md"))).toBe(false);
    });
  });

  describe("strict config loading (F37-1)", () => {
    it("exits 1 with stderr error when harness.config.json is malformed JSON", () => {
      tmpRoot = mkProject(undefined);
      // Overwrite with broken JSON so loadConfigSafe would silently
      // fall back to defaults.
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        "{ this is not json",
      );
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(1);
      expect(io.stderr.join("\n")).toMatch(
        /harness\.config\.json|JSON|parse|load/i,
      );
    });

    it("exits 1 when harness.config.json is a JSON value but not an object", () => {
      tmpRoot = mkProject(undefined);
      writeFileSync(join(tmpRoot, "harness.config.json"), "[1,2,3]");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(1);
      expect(io.stderr.join("\n")).toMatch(/object|array/i);
    });

    it("treats absent config as valid (no error, no-op-no-config)", () => {
      tmpRoot = mkProject(undefined); // no config file at all
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(0);
      expect(io.stdout.join("\n")).toMatch(/no-op/i);
    });
  });

  describe("validation errors", () => {
    it("exits 1 on absolute disciplineLedgerPath", () => {
      tmpRoot = mkProject("/etc/passwd");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(1);
      expect(io.stderr.join("\n")).toMatch(/absolute/i);
    });

    it("exits 1 on parent-traversal disciplineLedgerPath", () => {
      tmpRoot = mkProject("../escape.md");
      const io = captureIo();
      const code = runLedgerCli(
        [
          "append",
          "--session",
          "s",
          "--skill",
          "G2",
          "--impact",
          "i",
          "--remediation",
          "r",
        ],
        { cwd: tmpRoot, stdout: io.out, stderr: io.err },
      );
      expect(code).toBe(1);
      expect(io.stderr.join("\n")).toMatch(/parent|escape/i);
    });
  });
});
