/**
 * core/src/cr-cli.ts
 *
 * CodeRabbit CLI (`cr`) detector.
 *
 * Pseudo CR loop の Step 2 で `cr --agent --base <branch> --dir <path>` を
 * 直呼出する場合に必要な前提を確認する pure detector module。
 *
 * Detection order:
 *   1. `which cr` (binary が PATH にあるか)
 *   2. `cr --version` (動作するか)
 *   3. `cr auth status --agent` (auth が valid か)
 *
 * 設計原則:
 *   - DI: `spawn` 関数を inject 可能にして実 binary 呼出を unit test で mock 化
 *   - graceful: spawn 自体が throw しても detector は throw しない
 *   - 公式 docs (https://docs.coderabbit.ai/cli/reference) の `--agent` mode
 *     output を信頼境界とする — JSON 失敗 / unexpected schema は parse-error
 *
 * Bucket 帰属の caveat:
 *   - Codex research (04-cli-auth-ci.md) によれば PR review と CLI review の
 *     bucket 独立性は公式 docs で **未確認**、保守的に共有 5/h と仮定する
 *   - rate-limit が hit したら Pseudo CR loop は coderabbit-mimic agent
 *     (Codex 模倣) に fallback する設計 (本 detector の責務外)
 */

export interface CrSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CrSpawnFn = (argv: string[]) => CrSpawnResult;

export interface CrDetectorOptions {
  spawn: CrSpawnFn;
}

export type CrUnavailableReason =
  | "binary-missing"
  | "unauthenticated"
  | "parse-error";

export type CrCliDetection =
  | {
      available: true;
      version: string;
      authenticatedUser?: string;
      binaryPath: string;
    }
  | {
      available: false;
      reason: CrUnavailableReason;
    };

/**
 * Best-effort SemVer-ish 抽出。`cr X.Y.Z` / `cr X.Y.Z-pre.N` / `vX.Y.Z` を許容。
 */
export function parseVersionOutput(out: string): string | null {
  const m = out.match(/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/);
  return m?.[1] ?? null;
}

/**
 * `cr auth status --agent` の JSON output を parse。
 *
 * 公式 docs にある JSON schema:
 *   {"type":"auth_status","authenticated":true,"user":"<github-login>"}
 *
 * `authenticated` field 不在 / non-boolean は null (recognize 失敗)。
 */
export function parseAuthStatusJson(
  raw: string,
): { authenticated: boolean; user?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.authenticated !== "boolean") return null;
  const result: { authenticated: boolean; user?: string } = {
    authenticated: p.authenticated,
  };
  if (typeof p.user === "string") {
    result.user = p.user;
  }
  return result;
}

function safeRun(spawn: CrSpawnFn, argv: string[]): CrSpawnResult {
  try {
    return spawn(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 127, stdout: "", stderr: message };
  }
}

/**
 * Detect `cr` CLI presence and auth state.
 *
 * Returns `{ available: true, ... }` only when:
 *   - `which cr` returns a non-empty path
 *   - `cr --version` succeeds (exit 0) — version 抽出失敗でも続行する
 *   - `cr auth status --agent` returns JSON `{authenticated: true}`
 *
 * Otherwise returns `{ available: false, reason: ... }` with a categorized
 * reason so the caller can produce actionable guidance (install / login).
 */
export function detectCrCli(opts: CrDetectorOptions): CrCliDetection {
  const { spawn } = opts;

  const which = safeRun(spawn, ["which", "cr"]);
  const binaryPath = which.stdout.trim();
  if (which.exitCode !== 0 || binaryPath === "") {
    return { available: false, reason: "binary-missing" };
  }

  const version = safeRun(spawn, ["cr", "--version"]);
  // exit non-zero (binary 起動失敗 / 不正) → binary-missing。
  // exit 0 でも version 文字列の SemVer 抽出に失敗したら "unknown" として続行
  // — caller には version 値が "unknown" でも available:true を返すため、
  // "version 抽出失敗でも続行" 動作と "exit non-zero で停止" 動作の住み分けは
  // この 2 行で完結する (Codex review #6 で comment 矛盾指摘を反映)。
  if (version.exitCode !== 0) {
    return { available: false, reason: "binary-missing" };
  }
  const versionStr = parseVersionOutput(version.stdout) ?? "unknown";

  const auth = safeRun(spawn, ["cr", "auth", "status", "--agent"]);
  if (auth.exitCode !== 0) {
    return { available: false, reason: "unauthenticated" };
  }
  const authParsed = parseAuthStatusJson(auth.stdout);
  if (authParsed === null) {
    return { available: false, reason: "parse-error" };
  }
  if (!authParsed.authenticated) {
    return { available: false, reason: "unauthenticated" };
  }

  const result: CrCliDetection = {
    available: true,
    version: versionStr,
    binaryPath,
  };
  if (authParsed.user !== undefined) {
    result.authenticatedUser = authParsed.user;
  }
  return result;
}
