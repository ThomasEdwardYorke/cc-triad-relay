/**
 * core/src/__tests__/config-strict-mode.test.ts
 *
 * Strict-mode integration tests for `harness.config.json` shape validation
 * surfaces (Track C / Config strict mode follow-up).
 *
 * ## Why this file exists
 *
 * Several config consumers (e.g., `resolvePythonCandidateDirs` in
 * `subagent-stop.ts`) follow a fail-open contract: when `harness.config.json`
 * has a shape-invalid `tooling.pythonCandidateDirs` (non-array, empty array,
 * non-string entries, shell-metacharacter entries) the function emits a
 * stderr warning and falls back to defaults instead of throwing.
 *
 * Existing tests in `hooks.test.ts` cover the **fallback behavior** (default
 * dirs are used) but do NOT capture the stderr warning content. Without
 * coverage of the warning text, a future refactor could silently drop the
 * fail-open diagnostic and the test suite would still pass — leaving the
 * user with no visible signal that their config is malformed.
 *
 * This file adds strict-mode integration:
 * 1. Trigger the fail-open path (shape-invalid config, security-rejected entries)
 * 2. Capture `process.stderr.write` via direct monkey patch
 * 3. Assert the diagnostic prefix + actionable hint are present
 *
 * ## Stderr capture pattern
 *
 * We use `process.stderr.write` direct monkey patch (not `vi.spyOn(console,
 * 'error')`) for two reasons:
 * - The implementation calls `process.stderr.write()` directly (not
 *   `console.error()`), so console-level spies miss the writes
 * - `handoff-integration.test.ts` already uses this pattern, so the project
 *   has a proven precedent
 *
 * Each test save / restore the original `process.stderr.write` in a
 * try/finally so a thrown assertion never leaks the patched function to
 * subsequent tests.
 *
 * `captureStderr` accepts both sync and async subjects (`() => T | Promise<T>`)
 * because `detectAvailableChecks` may be refactored to async in the future
 * without invalidating the regression guard. Test bodies must `await` the
 * helper accordingly.
 *
 * ## Reference
 * - https://vitest.dev/guide/mocking.html (general mocking patterns)
 * - `subagent-stop.ts:99` resolvePythonCandidateDirs implementation
 * - Config strict mode follow-up: shape validation logging strict mode test
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectAvailableChecks } from "../hooks/subagent-stop.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeProject(opts: {
  hasPyproject?: boolean;
  hasSrc?: boolean;
  harnessConfig?: Record<string, unknown>;
  rawHarnessConfig?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-strict-test-"));
  tempDirs.push(dir);
  if (opts.hasPyproject) {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.ruff]\n", "utf-8");
  }
  if (opts.hasSrc) {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "__init__.py"), "", "utf-8");
  }
  if (opts.rawHarnessConfig !== undefined) {
    writeFileSync(join(dir, "harness.config.json"), opts.rawHarnessConfig, "utf-8");
  } else if (opts.harnessConfig) {
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify(opts.harnessConfig),
      "utf-8",
    );
  }
  return dir;
}

/**
 * Capture stderr writes during the execution of `subject()`.
 *
 * Uses direct monkey patch (not `vi.spyOn`) because the production code
 * calls `process.stderr.write()` directly. We restore the original write
 * function in a `try / finally` so a thrown assertion never leaks the
 * patched stderr into subsequent tests.
 *
 * `subject` may be sync or async — internal `await subject()` resolves
 * sync values immediately and waits for async ones, ensuring stderr
 * writes performed during async resolution are still captured before
 * `process.stderr.write` is restored.
 */
async function captureStderr<T>(
  subject: () => T | Promise<T>,
): Promise<{ result: T; stderr: string }> {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await subject();
    return { result, stderr: chunks.join("") };
  } finally {
    process.stderr.write = originalWrite as typeof process.stderr.write;
  }
}

describe("resolvePythonCandidateDirs (subagent-stop) — stderr fail-open warnings", () => {
  it("config が parse 失敗 (broken JSON) → 'parse failed' warning + default fallback", async () => {
    // 不完全な JSON で loadConfigWithError が parse error を返す → fail-open。
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      rawHarnessConfig: "{ broken json",
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    // Fall-back behavior: default ['src', 'app'] が使われる → src/ が ruff target
    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");

    // Strict-mode assertion: stderr に parse failed 警告 + default hint
    expect(stderr).toContain("[harness subagent-stop]");
    expect(stderr).toContain("parse failed");
    expect(stderr).toContain('["src", "app"]');
  });

  it("tooling.pythonCandidateDirs が string (非配列) → shape-invalid warning + default fallback", async () => {
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: "not-an-array" },
      },
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");

    expect(stderr).toContain("[harness subagent-stop]");
    expect(stderr).toContain("tooling.pythonCandidateDirs");
    expect(stderr).toContain("shape invalid");
    // Diagnostic must include the actual offending value so the user can
    // identify what they passed (regression guard for "silent shape-only" warnings).
    expect(stderr).toContain('"not-an-array"');
  });

  it("tooling.pythonCandidateDirs が非文字列を含む配列 → shape-invalid warning", async () => {
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: ["src", 42, "app"] as unknown },
      },
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    // shape invalid → defaults
    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");

    expect(stderr).toContain("shape invalid");
  });

  it("tooling.pythonCandidateDirs に shell-metacharacter entry → 'rejected' security warning", async () => {
    // Shell injection 防止 allowlist regex `/^[a-zA-Z0-9_.-]+$/` を violate。
    // `$(touch PWNED)` 等の command substitution は reject される。
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: ["src", "$(touch PWNED)"] },
      },
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    // Safe entry "src" は kept、unsafe は rejected → ruff target に "src/" が残る
    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");
    expect(ruff?.command).not.toContain("PWNED");

    // Security-related stderr message
    expect(stderr).toContain("[harness subagent-stop]");
    expect(stderr).toContain("rejected");
    expect(stderr).toContain("$(touch PWNED)");
    // Allowlist regex を user に見せて修正方法を示す
    expect(stderr).toContain("/^[a-zA-Z0-9_.-]+$/");
  });

  it("path separator entry (e.g., '../etc') → 'rejected' security warning", async () => {
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: ["src", "../etc"] },
      },
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");
    expect(ruff?.command).not.toContain("etc");

    expect(stderr).toContain("rejected");
    expect(stderr).toContain("../etc");
  });

  it("全 entry が unsafe → defaults fallback + rejected warning", async () => {
    // 安全な entry が 1 つも無いケース。default `['src', 'app']` に fallback。
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: ["$(rm)", "/etc/passwd"] },
      },
    });

    const { result, stderr } = await captureStderr(() =>
      detectAvailableChecks(dir),
    );

    // src/ は default で拾える (hasSrc=true)
    const ruff = result.find((c) => c.tool === "ruff");
    expect(ruff?.command).toContain("src/");

    expect(stderr).toContain("rejected");
    // 全 reject なので safe list が空、rejected list に両 entry が含まれる
    expect(stderr).toContain("$(rm)");
    expect(stderr).toContain("/etc/passwd");
  });

  it("正常な config (string entries) → stderr 出力なし (silent path)", async () => {
    // Sanity check: config が valid なら stderr に何も出ないこと (regression guard
    // for "always emit warnings" bug)。
    const dir = makeProject({
      hasPyproject: true,
      hasSrc: true,
      harnessConfig: {
        tooling: { pythonCandidateDirs: ["src"] },
      },
    });

    const { stderr } = await captureStderr(() => detectAvailableChecks(dir));

    expect(stderr).toBe("");
  });

  it("config 不在 → stderr 出力なし (default 経路)", async () => {
    // harness.config.json が無い場合は最も一般的な case で、stderr に
    // 何も出ないことを確認 (silent default path)。
    const dir = makeProject({ hasPyproject: true, hasSrc: true });

    const { stderr } = await captureStderr(() => detectAvailableChecks(dir));

    expect(stderr).toBe("");
  });
});
