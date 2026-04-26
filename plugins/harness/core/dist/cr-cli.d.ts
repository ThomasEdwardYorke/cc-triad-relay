/**
 * core/src/cr-cli.ts
 *
 * CodeRabbit CLI (`coderabbit`) detector.
 *
 * Pseudo CR loop の Step 2 で
 * `coderabbit --agent --base <branch> --dir <path>` を直呼出する場合に必要な
 * 前提を確認する pure detector module。
 *
 * Detection order:
 *   1. `which coderabbit` (binary が PATH にあるか)
 *   2. `coderabbit --version` (動作するか)
 *   3. `coderabbit auth status --agent` (auth が valid か)
 *
 * Binary name の注意:
 *   - 公式 install (`brew install --cask coderabbit`) の binary 名は
 *     **`coderabbit`** (`cr` ではない、よくある誤解)
 *   - 旧実装は `cr` を spawn しており、homebrew 経由 install 環境では常に
 *     `binary-missing` を返してしまっていた (本 wrapper で `coderabbit` 化済)
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
export type CrUnavailableReason = "binary-missing" | "unauthenticated" | "parse-error";
export type CrCliDetection = {
    available: true;
    version: string;
    authenticatedUser?: string;
    binaryPath: string;
} | {
    available: false;
    reason: CrUnavailableReason;
};
/**
 * Best-effort SemVer-ish 抽出。`X.Y.Z` / `X.Y.Z-pre.N` / `vX.Y.Z` を許容。
 * 前置 token (`cr` / `coderabbit` / `v` 等) は無視して数値部分のみ抽出する。
 */
export declare function parseVersionOutput(out: string): string | null;
/**
 * `coderabbit auth status --agent` の JSON output を parse。
 *
 * 公式 docs にある JSON schema:
 *   {"type":"auth_status","authenticated":true,"user":"<github-login>"}
 *
 * `authenticated` field 不在 / non-boolean は null (recognize 失敗)。
 */
export declare function parseAuthStatusJson(raw: string): {
    authenticated: boolean;
    user?: string;
} | null;
/**
 * Detect `coderabbit` CLI presence and auth state.
 *
 * Returns `{ available: true, ... }` only when:
 *   - `which coderabbit` returns a non-empty path
 *   - `coderabbit --version` succeeds (exit 0) — version 抽出失敗でも続行する
 *   - `coderabbit auth status --agent` returns JSON `{authenticated: true}`
 *
 * Otherwise returns `{ available: false, reason: ... }` with a categorized
 * reason so the caller can produce actionable guidance (install / login).
 */
export declare function detectCrCli(opts: CrDetectorOptions): CrCliDetection;
//# sourceMappingURL=cr-cli.d.ts.map