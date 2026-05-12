/**
 * core/src/__tests__/mock-claude.test.ts
 *
 * Argv contract test for `tests/e2e/fixtures/mock-claude.sh`.
 *
 * 目的:
 *   parallel-worktree-v2 e2e smoke の fixture (mock claude CLI) が、
 *   実 claude CLI と同じ argv shape (`-n <slug>` 必須 / `--model <alias>` /
 *   `--permission-mode <mode>` 任意) で呼ばれた際に「値欠落」を fail-fast
 *   検出することを固定する。
 *
 *   `--model | --permission-mode) shift 2 || true` のような失敗呑込
 *   pattern は値欠落時に外側の `while [[ $# -gt 0 ]]` を無限ループ
 *   させる。CI で hung テスト → 60s polling timeout で "session never
 *   reached terminal status" と誤検出される。本 test は該当 regression
 *   を必ず捕捉する。
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tests/e2e/fixtures/mock-claude.sh");

function runMock(
  args: string[] = [],
  env: Record<string, string> = {},
  timeoutMs = 5000,
): { stdout: string; stderr: string; status: number | null; signal: NodeJS.Signals | null } {
  const r = spawnSync("bash", [SCRIPT_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env, LC_ALL: "C", LANG: "C" },
    timeout: timeoutMs,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status,
    signal: r.signal,
  };
}

describe("mock-claude.sh: file existence and shebang", () => {
  it("fixture script exists", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });
});

describe("mock-claude.sh: argv parsing fail-fast on missing values", () => {
  // Each spawnSync uses a 5s timeout. If the fixture regresses to a
  // failure-swallowing `shift 2 || true` pattern, the inner `while` never
  // advances and the process is killed by SIGTERM after 5s. We assert on
  // `status` *and* `signal` so that timeout-induced termination is
  // distinguishable from the desired non-zero exit.

  it("fails fast (non-zero exit, no timeout) when -n is supplied without a value", () => {
    const r = runMock(["-n"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/-n requires a value|missing/i);
  });

  it("fails fast when --model is supplied without a value", () => {
    const r = runMock(["-n", "alpha", "--model"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--model requires a value|missing/i);
  });

  it("fails fast when --permission-mode is supplied without a value", () => {
    const r = runMock(["-n", "alpha", "--permission-mode"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--permission-mode requires a value|missing/i);
  });

  it("accepts --model with a value (option-and-value pair)", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "mock-claude-test-"));
    try {
      const r = runMock(["-n", "alpha", "--model", "claude-sonnet-4-6"], {
        CLAUDE_ONESHOT_LOG_DIR: sandbox,
      });
      expect(r.signal).toBeNull();
      expect(r.status).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("accepts --permission-mode with a value", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "mock-claude-test-"));
    try {
      const r = runMock(
        ["-n", "alpha", "--permission-mode", "acceptEdits"],
        { CLAUDE_ONESHOT_LOG_DIR: sandbox },
      );
      expect(r.signal).toBeNull();
      expect(r.status).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("accepts -n with a value when no --model / --permission-mode is supplied", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "mock-claude-test-"));
    try {
      const r = runMock(["-n", "alpha"], {
        CLAUDE_ONESHOT_LOG_DIR: sandbox,
      });
      expect(r.signal).toBeNull();
      expect(r.status).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("mock-claude.sh: SLUG validation (path-traversal hardening)", () => {
  // SLUG flows directly into LOG_FILE = ${LOG_DIR}/claude-log-${SLUG}.jsonl,
  // so an unvalidated value containing `/`, `..`, or a leading dot would
  // write outside CLAUDE_ONESHOT_LOG_DIR. The fixture mirrors
  // parallel-sessions-template.sh `validate_slug` charset
  // (`[A-Za-z_][A-Za-z0-9_-]*`). Dots stay rejected because tmux target syntax
  // treats them as pane separators; leading digits stay rejected because tmux
  // tries numeric window indexes before exact names.

  it("rejects SLUG containing path-separator '/' (directory traversal)", () => {
    const r = runMock(["-n", "alpha/escape"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug/i);
  });

  it("rejects SLUG containing '..' (parent-directory escape)", () => {
    const r = runMock(["-n", "alpha..escape"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug|\.\./);
  });

  it("rejects SLUG starting with '.' (hidden-file alias)", () => {
    const r = runMock(["-n", ".hidden"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug|must not start with/i);
  });

  it("rejects SLUG containing '.' (tmux target-pane separator)", () => {
    const r = runMock(["-n", "api.v2"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug/i);
  });

  it("rejects SLUG starting with digit (tmux target-window ambiguity)", () => {
    const r = runMock(["-n", "2alpha"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug/i);
  });

  it("rejects SLUG containing whitespace (would break LOG_FILE quoting)", () => {
    const r = runMock(["-n", "alpha beta"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid -n|slug/i);
  });

  it("rejects SLUG containing shell metacharacters (e.g. ';', '$', backticks)", () => {
    for (const slug of ["alpha;rm", "alpha$x", "alpha`evil`"]) {
      const r = runMock(["-n", slug]);
      expect(r.signal).toBeNull();
      expect(r.status).not.toBe(0);
    }
  });

  it("accepts SLUG matching [A-Za-z_][A-Za-z0-9_-]* (launcher-compatible)", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "mock-claude-test-"));
    try {
      for (const slug of ["alpha", "alpha-1", "alpha_2", "ABC123"]) {
        const r = runMock(["-n", slug], {
          CLAUDE_ONESHOT_LOG_DIR: sandbox,
        });
        expect(r.signal).toBeNull();
        expect(r.status).toBe(0);
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("mock-claude.sh: unknown-option fail-fast", () => {
  // The mock must reject unknown options so that a launcher-side CLI
  // contract change (e.g. a new `--print` or `--output-format` flag the
  // mock does not yet understand) surfaces as a smoke failure instead
  // of being silently swallowed by the catch-all `*)` branch.

  it("fails fast on an unrecognised long option", () => {
    const r = runMock(["-n", "alpha", "--unknown-flag", "value"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown option/i);
  });

  it("fails fast on an unrecognised short option", () => {
    const r = runMock(["-n", "alpha", "-x"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown option/i);
  });

  it("fails fast on a `--option=value` style unknown flag", () => {
    // Real claude CLI does not accept `=` form, but the launcher might
    // grow one. The catch-all should treat it as an unknown long option
    // and reject rather than silently shifting.
    const r = runMock(["-n", "alpha", "--permission-mode=acceptEdits"]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown option/i);
  });
});
