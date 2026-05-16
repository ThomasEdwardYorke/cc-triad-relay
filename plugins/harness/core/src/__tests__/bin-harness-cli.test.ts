/**
 * core/src/__tests__/bin-harness-cli.test.ts
 *
 * `bin/harness` CLI の onboarding-completeness を検証する E2E test。
 * `child_process.execFileSync` 経由で実 CLI を呼び、tmpdir に対して
 * `init` / `check` の振る舞いを確認する。
 *
 * 目的:
 *   - 新規プロジェクトに install して `harness init` した直後から
 *     `.coderabbit.yaml` / `Plans.md` / `CLAUDE.md` / `.claude/rules/`
 *     が揃った状態を担保
 *   - `.coderabbit.yaml` の `request_changes_workflow: true` 漏れを
 *     `harness check` で検出 (consumer の手作業漏れ防止)
 *   - external dependency (gh / codex / coderabbit) の不在も WARN
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const HARNESS_BIN = resolve(PLUGIN_ROOT, "bin/harness");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runHarness(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): RunResult {
  // execFileSync は exit code != 0 で throw するので catch で結果を吸い上げる。
  // `node` で直接呼び出して shebang 依存を排除 (CI runner の +x 権限差を吸収)。
  try {
    const stdout = execFileSync("node", [HARNESS_BIN, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: stdout.toString(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? ""),
      exitCode: typeof err.status === "number" ? err.status : 1,
    };
  }
}

describe("bin/harness check — project state recommendations (onboarding gap detection)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-check-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(".coderabbit.yaml 不在で WARN を出力 (新 onboarding gap)", () => {
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    const combined = result.stdout + result.stderr;
    // `.coderabbit.yaml` line に WARN + "not found" 相当の文言
    expect(combined).toMatch(/\.coderabbit\.yaml[\s\S]*?WARN[\s\S]*?not found/i);
  });

  it(".coderabbit.yaml に request_changes_workflow: true があれば OK", () => {
    writeFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "reviews:\n  request_changes_workflow: true\n  profile: chill\n",
    );
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/\.coderabbit\.yaml\s+OK/);
  });

  it(".coderabbit.yaml に request_changes_workflow が無いと WARN", () => {
    writeFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "reviews:\n  profile: chill\n",
    );
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/request_changes_workflow|APPROVED|auto-fire/i);
    expect(combined).toMatch(/WARN/);
  });

  it("external dependency 行が check 出力に含まれる (gh / codex / coderabbit)", () => {
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    const combined = result.stdout + result.stderr;
    // 各 binary が OK / WARN いずれかで報告 (PATH に存在 / 不在を区別せず行存在のみ確認)
    expect(combined).toMatch(/\bgh\b/);
    expect(combined).toMatch(/\bcodex\b/);
    expect(combined).toMatch(/\bcoderabbit\b/);
  });

  it("plugin integrity が壊れていなければ exit 0 (project warnings は non-blocking)", () => {
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    expect(result.exitCode).toBe(0);
  });

  it("`#` で始まるコメント行内の request_changes_workflow: true を OK 判定しない (Codex Phase 7 指摘 #1 対応、false-positive 防止)", () => {
    // 文書化目的の comment 行 (`# request_changes_workflow: true (legacy doc)`)
    // が yaml に含まれていても、実値定義として誤検出しないことを確認。
    // 実装側は `#` 始まり line を pre-strip してから regex 判定する。
    writeFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "# request_changes_workflow: true (legacy doc snippet)\nreviews:\n  profile: chill\n",
    );
    const result = runHarness(["check"], {
      env: { CLAUDE_PROJECT_DIR: tmpDir },
    });
    const combined = result.stdout + result.stderr;
    // 実 yaml では request_changes_workflow が未定義 → WARN
    expect(combined).toMatch(/\.coderabbit\.yaml[\s\S]*?WARN/);
    expect(combined).toMatch(/request_changes_workflow|auto-fire/i);
  });
});

describe("bin/harness pr-metrics — PR metrics collection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-pr-metrics-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("root usage advertises the PR metrics command", () => {
    const result = runHarness(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("harness pr-metrics --pr-range <from>..<to>");
  });

  it("requires --pr-range before collecting metrics", () => {
    const result = runHarness(["pr-metrics"], { cwd: tmpDir });
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(2);
    expect(combined).toContain("harness pr-metrics");
    expect(combined).toContain("--pr-range");
  });

  it("prints pr-metrics help to stdout", () => {
    const result = runHarness(["pr-metrics", "--help"], { cwd: tmpDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: harness pr-metrics");
    expect(result.stdout).toContain("--input PATH");
    expect(result.stdout).toContain("--manual-metrics PATH");
  });

  it("writes JSON and Markdown metrics reports from an offline PR fixture", () => {
    const inputPath = join(tmpDir, "prs.json");
    const jsonOut = join(tmpDir, "pr-metrics.json");
    const mdOut = join(tmpDir, "pr-metrics-2026-05-12.md");
    writeFileSync(
      inputPath,
      JSON.stringify(
        {
          repository: "example-org/my-project",
          prs: [
            {
              number: 90,
              title: "feat: add first pilot endpoint",
              url: "https://github.com/example-org/my-project/pull/90",
              state: "MERGED",
              createdAt: "2026-05-10T00:00:00Z",
              mergedAt: "2026-05-10T03:30:00Z",
              reviews: [
                { state: "CHANGES_REQUESTED", author: { login: "coderabbitai" } },
                { state: "APPROVED", author: { login: "coderabbitai" } },
                { state: "COMMENTED", author: { login: "reviewer" } },
              ],
            },
            {
              number: 91,
              title: "fix: second pilot cleanup",
              url: "https://github.com/example-org/my-project/pull/91",
              state: "MERGED",
              createdAt: "2026-05-10T04:00:00Z",
              mergedAt: "2026-05-10T05:00:00Z",
              reviews: [{ state: "APPROVED", author: { login: "coderabbitai[bot]" } }],
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = runHarness(
      [
        "pr-metrics",
        "--pr-range",
        "90..91",
        "--input",
        inputPath,
        "--output-json",
        jsonOut,
        "--output-md",
        mdOut,
      ],
      { cwd: tmpDir },
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(jsonOut)).toBe(true);
    expect(existsSync(mdOut)).toBe(true);

    const metrics = JSON.parse(readFileSync(jsonOut, "utf-8"));
    expect(metrics.source.pr_range).toBe("90..91");
    expect(metrics.summary.pr_count).toBe(2);
    expect(metrics.summary.merged_pr_count).toBe(2);
    expect(metrics.summary.wallclock_hours_median).toBe(2.25);
    expect(metrics.summary.wallclock_hours_max).toBe(3.5);
    expect(metrics.summary.coderabbit_reviews_total).toBe(3);
    expect(metrics.summary.coderabbit_change_requests_total).toBe(1);
    expect(metrics.summary.coderabbit_approvals_total).toBe(2);
    expect(metrics.prs[0].manual_metrics.operator_load).toBeNull();

    const md = readFileSync(mdOut, "utf-8");
    expect(md).toContain("# PR Metrics Report");
    expect(md).toContain("PR #90");
    expect(md).toContain("Manual metrics");
    expect(md).toContain("TBD");
  });

  it("overlays operator-supplied manual metrics from a sidecar fixture", () => {
    const inputPath = join(tmpDir, "prs.json");
    const manualPath = join(tmpDir, "manual-metrics.json");
    const jsonOut = join(tmpDir, "pr-metrics.json");
    const mdOut = join(tmpDir, "pr-metrics.md");
    writeFileSync(
      inputPath,
      JSON.stringify(
        {
          repository: "example-org/my-project",
          prs: [
            {
              number: 90,
              title: "feat: first Model B slice",
              url: "https://github.com/example-org/my-project/pull/90",
              state: "MERGED",
              createdAt: "2026-05-10T00:00:00Z",
              mergedAt: "2026-05-10T01:00:00Z",
              reviews: [],
            },
            {
              number: 91,
              title: "fix: second Model B slice",
              url: "https://github.com/example-org/my-project/pull/91",
              state: "MERGED",
              createdAt: "2026-05-10T02:00:00Z",
              mergedAt: "2026-05-10T03:00:00Z",
              reviews: [],
            },
          ],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      manualPath,
      JSON.stringify(
        {
          "90": {
            api_token_cost: "42.5",
            independent_review_rework_rounds: 2,
            post_merge_hotfixes_7d: 0,
            operator_load: 3,
          },
          "91": {
            operator_load: "review reply x1",
          },
        },
        null,
        2,
      ),
    );

    const result = runHarness(
      [
        "pr-metrics",
        "--pr-range",
        "90..91",
        "--input",
        inputPath,
        "--manual-metrics",
        manualPath,
        "--output-json",
        jsonOut,
        "--output-md",
        mdOut,
      ],
      { cwd: tmpDir },
    );

    expect(result.exitCode).toBe(0);

    const metrics = JSON.parse(readFileSync(jsonOut, "utf-8"));
    expect(metrics.source.manual_metrics).toBe(resolve(manualPath));
    expect(metrics.prs[0].manual_metrics).toEqual({
      api_token_cost: 42.5,
      independent_review_rework_rounds: 2,
      post_merge_hotfixes_7d: 0,
      operator_load: 3,
    });
    expect(metrics.prs[1].manual_metrics.operator_load).toBe("review reply x1");
    expect(metrics.prs[1].manual_metrics.api_token_cost).toBeNull();

    const md = readFileSync(mdOut, "utf-8");
    expect(md).toContain("PR #90 | 42.5 | 2 | 0 | 3");
    expect(md).toContain("PR #91 | TBD | TBD | TBD | review reply x1");
  });

  it("rejects non-numeric manual values for numeric metrics", () => {
    const inputPath = join(tmpDir, "prs.json");
    const manualPath = join(tmpDir, "manual-metrics.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        prs: [
          {
            number: 90,
            title: "feat: first Model B slice",
            state: "MERGED",
            createdAt: "2026-05-10T00:00:00Z",
            mergedAt: "2026-05-10T01:00:00Z",
            reviews: [],
          },
        ],
      }),
    );
    writeFileSync(
      manualPath,
      JSON.stringify({
        "90": {
          api_token_cost: "n/a",
        },
      }),
    );

    const result = runHarness(
      ["pr-metrics", "--pr-range", "90..90", "--input", inputPath, "--manual-metrics", manualPath],
      { cwd: tmpDir },
    );
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(1);
    expect(combined).toContain("api_token_cost");
    expect(combined).toContain("must be numeric");
  });

  it("rejects unknown manual metrics fields instead of silently dropping typos", () => {
    const inputPath = join(tmpDir, "prs.json");
    const manualPath = join(tmpDir, "manual-metrics.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        prs: [
          {
            number: 90,
            title: "feat: first Model B slice",
            state: "MERGED",
            createdAt: "2026-05-10T00:00:00Z",
            mergedAt: "2026-05-10T01:00:00Z",
            reviews: [],
          },
        ],
      }),
    );
    writeFileSync(
      manualPath,
      JSON.stringify({
        "90": {
          api_token_costs: 42.5,
        },
      }),
    );

    const result = runHarness(
      ["pr-metrics", "--pr-range", "90..90", "--input", inputPath, "--manual-metrics", manualPath],
      { cwd: tmpDir },
    );
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(1);
    expect(combined).toContain("unknown field 'api_token_costs'");
  });

  it("fails closed when the offline fixture is missing requested PR numbers", () => {
    const inputPath = join(tmpDir, "prs-missing.json");
    writeFileSync(
      inputPath,
      JSON.stringify(
        {
          prs: [
            {
              number: 90,
              title: "feat: only one PR",
              state: "MERGED",
              createdAt: "2026-05-10T00:00:00Z",
              mergedAt: "2026-05-10T01:00:00Z",
              reviews: [],
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = runHarness(
      ["pr-metrics", "--pr-range", "90..91", "--input", inputPath],
      { cwd: tmpDir },
    );
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(1);
    expect(combined).toContain("missing PR data for requested range");
    expect(combined).toContain("#91");
  });

  it("fails closed with aggregated missing PR numbers when gh cannot fetch a requested PR", () => {
    const fakeGhHook = join(tmpDir, "fake-gh-hook.cjs");
    writeFileSync(
      fakeGhHook,
      [
        "const childProcess = require('node:child_process');",
        "const { syncBuiltinESMExports } = require('node:module');",
        "const originalExecFileSync = childProcess.execFileSync;",
        "childProcess.execFileSync = function fakeGhExecFileSync(file, args = [], options) {",
        "  if ((file === 'which' || file === 'where') && args[0] === 'gh') {",
        "    return '';",
        "  }",
        "  if (file !== 'gh') {",
        "    return originalExecFileSync.apply(this, arguments);",
        "  }",
        "  if (args[0] === 'repo' && args[1] === 'view') {",
        "    return JSON.stringify({ nameWithOwner: 'example-org/my-project' });",
        "  }",
        "  if (args[0] === 'pr' && args[1] === 'view') {",
        "    const number = args[2];",
        "    if (number === '90') {",
        "      return JSON.stringify({",
        "        number: 90,",
        "        title: 'feat: first PR',",
        "        url: 'https://github.com/example-org/my-project/pull/90',",
        "        state: 'MERGED',",
        "        createdAt: '2026-05-10T00:00:00Z',",
        "        mergedAt: '2026-05-10T01:00:00Z',",
        "        reviews: []",
        "      });",
        "    }",
        "    throw new Error(`missing PR ${number}`);",
        "  }",
        "  throw new Error(`unexpected gh args: ${args.join(' ')}`);",
        "}",
        "syncBuiltinESMExports();",
        "",
      ].join("\n"),
    );

    const jsonOut = join(tmpDir, "pr-metrics.json");
    const mdOut = join(tmpDir, "pr-metrics.md");
    const result = runHarness(
      [
        "pr-metrics",
        "--pr-range",
        "90..91",
        "--output-json",
        jsonOut,
        "--output-md",
        mdOut,
      ],
      {
        cwd: tmpDir,
        env: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${fakeGhHook}`.trim(),
        },
      },
    );
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(1);
    expect(combined).toContain("missing PR data for requested range");
    expect(combined).toContain("#91");
    expect(existsSync(jsonOut)).toBe(false);
    expect(existsSync(mdOut)).toBe(false);
  });
});

describe("bin/harness session-manager — dashboard refresh", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-session-manager-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("root usage advertises the session-manager watch command", () => {
    const result = runHarness(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("harness session-manager watch");
  });

  it("prints session-manager help to stdout", () => {
    const result = runHarness(["session-manager", "--help"], { cwd: tmpDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: harness session-manager");
    expect(result.stdout).toContain("once");
    expect(result.stdout).toContain("watch");
    expect(result.stdout).toContain("--interval-seconds");
  });

  it("requires slugs before rendering a session-manager dashboard", () => {
    const result = runHarness(["session-manager", "watch"], { cwd: tmpDir });
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(2);
    expect(combined).toContain("--slugs");
  });

  it("allows an explicit empty worktree prefix for projects without prefixed worktrees", () => {
    const result = runHarness(
      [
        "session-manager",
        "once",
        "--slugs",
        "frontend",
        "--worktree-parent",
        tmpDir,
        "--worktree-prefix",
        "",
      ],
      { cwd: tmpDir },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("| frontend |");
  });

  it("renders a one-shot dashboard from offline session logs", () => {
    const logDir = join(tmpDir, "logs");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, "claude-log-frontend.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-15T00:00:00.000Z",
        message: {
          content: [{ type: "text", text: "Phase 5 GREEN complete" }],
        },
      }) + "\n",
    );

    const result = runHarness(
      [
        "session-manager",
        "once",
        "--slugs",
        "frontend",
        "--log-dir",
        logDir,
        "--now",
        "2026-05-15T00:01:00.000Z",
      ],
      { cwd: tmpDir },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("| slug | branch | phase | last commit | status |");
    expect(result.stdout).toContain("| frontend |");
    expect(result.stdout).toContain("Phase 5");
    expect(result.stdout).toContain("| running |");
  });

  it("watch mode can run a deterministic bounded refresh loop without platform watch", () => {
    const logDir = join(tmpDir, "logs");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, "claude-log-api.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-15T00:00:00.000Z",
        message: {
          content: [{ type: "text", text: "Phase 6 Real CR approved" }],
        },
      }) + "\n",
    );

    const result = runHarness(
      [
        "session-manager",
        "watch",
        "--slugs",
        "api",
        "--log-dir",
        logDir,
        "--interval-seconds",
        "1",
        "--iterations",
        "2",
        "--now",
        "2026-05-15T00:01:00.000Z",
      ],
      {
        cwd: tmpDir,
        env: { HARNESS_SESSION_MANAGER_SLEEP_MS: "0" },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("session-manager watch: refresh every 1s");
    expect((result.stdout.match(/\| api \|/g) ?? []).length).toBe(2);
    expect(result.stdout).toContain("Phase 6");
  });
});

describe("bin/harness init — extended bootstrap (template-driven)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("空プロジェクトで harness.config.json を bootstrap (既存 inline 動作維持)", () => {
    const result = runHarness(["init"], { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(tmpDir, "harness.config.json"))).toBe(true);
  });

  it("CLAUDE.md / Plans.md / .coderabbit.yaml を bootstrap (template から copy)", () => {
    runHarness(["init"], { cwd: tmpDir });
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "Plans.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".coderabbit.yaml"))).toBe(true);
  });

  it(".coderabbit.yaml の content に request_changes_workflow: true が含まれる", () => {
    runHarness(["init"], { cwd: tmpDir });
    const yaml = readFileSync(join(tmpDir, ".coderabbit.yaml"), "utf-8");
    // template 由来。consumer 自作で漏れがちな key を init で確実に配布
    expect(yaml).toMatch(/request_changes_workflow:\s*true/);
  });

  it(".claude/rules/*.md が recursive copy される (auto-load 用)", () => {
    runHarness(["init"], { cwd: tmpDir });
    // template/.claude/rules/ には複数 .md が存在する
    expect(existsSync(join(tmpDir, ".claude/rules/tdd-policy.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".claude/rules/branching-strategy.md"))).toBe(true);
  });

  it(".claude/settings.local.json が bootstrap される (permissions)", () => {
    runHarness(["init"], { cwd: tmpDir });
    expect(existsSync(join(tmpDir, ".claude/settings.local.json"))).toBe(true);
  });

  it(".github/workflows/harness-check.yml が bootstrap される (CI workflow)", () => {
    runHarness(["init"], { cwd: tmpDir });
    expect(
      existsSync(join(tmpDir, ".github/workflows/harness-check.yml")),
    ).toBe(true);
    const yml = readFileSync(
      join(tmpDir, ".github/workflows/harness-check.yml"),
      "utf-8",
    );
    expect(yml).toMatch(/harness\s+check/);
  });

  it("CLAUDE.md の {{PROJECT_NAME}} placeholder が cwd basename で置換される", () => {
    runHarness(["init"], { cwd: tmpDir });
    const claudeMd = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("{{PROJECT_NAME}}");
    expect(claudeMd).toContain(basename(tmpDir));
  });

  it("既存 CLAUDE.md は overwrite しない (既存 work 保護)", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "EXISTING CONTENT");
    runHarness(["init"], { cwd: tmpDir });
    const md = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(md).toBe("EXISTING CONTENT");
  });

  it("既存 .coderabbit.yaml は overwrite しない", () => {
    writeFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "# user-customized\nlanguage: ja-JP\n",
    );
    runHarness(["init"], { cwd: tmpDir });
    const yaml = readFileSync(join(tmpDir, ".coderabbit.yaml"), "utf-8");
    expect(yaml).toContain("user-customized");
  });

  it("既存 harness.config.json は overwrite しない (既存動作互換)", () => {
    writeFileSync(
      join(tmpDir, "harness.config.json"),
      '{"projectName":"existing"}',
    );
    runHarness(["init"], { cwd: tmpDir });
    const cfg = JSON.parse(
      readFileSync(join(tmpDir, "harness.config.json"), "utf-8"),
    );
    expect(cfg.projectName).toBe("existing");
  });

  it("二重 init は idempotent (既存 file の content 不変)", () => {
    runHarness(["init"], { cwd: tmpDir });
    const beforeMd = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    const beforeYaml = readFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "utf-8",
    );
    runHarness(["init"], { cwd: tmpDir });
    const afterMd = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    const afterYaml = readFileSync(
      join(tmpDir, ".coderabbit.yaml"),
      "utf-8",
    );
    expect(afterMd).toBe(beforeMd);
    expect(afterYaml).toBe(beforeYaml);
  });

  it("CLAUDE_PROJECT_DIR env が cwd より優先される (Codex Phase 7 指摘 #2 対応)", () => {
    // hook-invoked CLI で cwd と project root が分離するケースに対応。
    // env が指定されていれば bootstrap 先は env 側で一元化される。
    const altDir = mkdtempSync(join(tmpdir(), "harness-init-altdir-"));
    try {
      runHarness(["init"], {
        cwd: tmpDir,
        env: { CLAUDE_PROJECT_DIR: altDir },
      });
      // Bootstrap files は altDir 側に作られる
      expect(existsSync(join(altDir, "harness.config.json"))).toBe(true);
      expect(existsSync(join(altDir, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(altDir, ".coderabbit.yaml"))).toBe(true);
      // tmpDir 側は touch されない (silent な誤配置がないことを確認)
      expect(existsSync(join(tmpDir, "harness.config.json"))).toBe(false);
      expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false);
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});
