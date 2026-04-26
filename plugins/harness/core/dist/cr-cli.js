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
/**
 * Best-effort SemVer-ish 抽出。`X.Y.Z` / `X.Y.Z-pre.N` / `vX.Y.Z` を許容。
 * 前置 token (`cr` / `coderabbit` / `v` 等) は無視して数値部分のみ抽出する。
 */
export function parseVersionOutput(out) {
    const m = out.match(/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/);
    return m?.[1] ?? null;
}
/**
 * `coderabbit auth status --agent` の JSON output を parse。
 *
 * 公式 docs にある JSON schema:
 *   {"type":"auth_status","authenticated":true,"user":"<github-login>"}
 *
 * `authenticated` field 不在 / non-boolean は null (recognize 失敗)。
 */
export function parseAuthStatusJson(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object")
        return null;
    const p = parsed;
    if (typeof p.authenticated !== "boolean")
        return null;
    const result = {
        authenticated: p.authenticated,
    };
    if (typeof p.user === "string") {
        result.user = p.user;
    }
    return result;
}
function safeRun(spawn, argv) {
    try {
        return spawn(argv);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 127, stdout: "", stderr: message };
    }
}
/**
 * `coderabbit` CLI binary name. Homebrew install (`brew install --cask coderabbit`)
 * の出力 binary 名と一致させる必要がある (旧実装の `cr` は誤り)。
 */
const CR_BINARY = "coderabbit";
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
export function detectCrCli(opts) {
    const { spawn } = opts;
    const which = safeRun(spawn, ["which", CR_BINARY]);
    const binaryPath = which.stdout.trim();
    if (which.exitCode !== 0 || binaryPath === "") {
        return { available: false, reason: "binary-missing" };
    }
    const version = safeRun(spawn, [CR_BINARY, "--version"]);
    // exit non-zero (binary 起動失敗 / 不正) → binary-missing。
    // exit 0 でも version 文字列の SemVer 抽出に失敗したら "unknown" として続行
    // — caller には version 値が "unknown" でも available:true を返すため、
    // "version 抽出失敗でも続行" 動作と "exit non-zero で停止" 動作の住み分けは
    // この 2 行で完結する。
    if (version.exitCode !== 0) {
        return { available: false, reason: "binary-missing" };
    }
    const versionStr = parseVersionOutput(version.stdout) ?? "unknown";
    const auth = safeRun(spawn, [CR_BINARY, "auth", "status", "--agent"]);
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
    const result = {
        available: true,
        version: versionStr,
        binaryPath,
    };
    if (authParsed.user !== undefined) {
        result.authenticatedUser = authParsed.user;
    }
    return result;
}
//# sourceMappingURL=cr-cli.js.map