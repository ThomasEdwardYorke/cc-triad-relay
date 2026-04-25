/**
 * core/src/cr-cache.ts
 *
 * Diff fingerprint cache for CodeRabbit / pseudo-CodeRabbit review results.
 *
 * 同 commit hash + 同 profile + 同 .coderabbit.yaml + 同 path_instructions
 * の場合、review findings は不変なので再 review を skip する。
 *
 * Cache key: SHA-256(diff || \0 || profile || \0 || coderabbit_yaml || \0 || path_instructions_hash)
 * Cache loc: <workdir>/.coderabbit-cache/<fingerprint>.json
 *
 * 設計原則:
 *   - corrupt JSON / missing entry は null を返し throw しない (graceful degradation)
 *   - path traversal 防御: fingerprint は 64-char lowercase hex のみ
 *   - invalidate は idempotent
 *   - file format は pretty-printed JSON (人間が直接見て debug できる)
 *   - field delimiter は NUL byte (`\0`) — space を含む input でも collision しない
 *   - writeCache は atomic (tmp file + renameSync で partial write 中の reader 安全性)
 */
export declare const CACHE_DIR_NAME = ".coderabbit-cache";
export interface FingerprintInput {
    /** `git diff <base>..HEAD` の出力 (text) */
    diff: string;
    /** Resolved profile (chill | assertive | strict) */
    profile: string;
    /** `.coderabbit.yaml` の生 content (file 不在時は空文字)。caller で hash 化していてもよい */
    coderabbitYaml: string;
    /** path_instructions の事前計算 hash (caller で SHA-256 等を計算済) */
    pathInstructionsHash: string;
}
/**
 * Compute deterministic SHA-256 fingerprint from review-input fields.
 *
 * NUL byte delimiter で field 境界を明示し、
 * `diff="A" + profile="BC"` と `diff="AB" + profile="C"` の sha256 collision
 * を防ぐ。さらに space を含む input (`"A B"` 等) でも区別される。
 */
export declare function computeFingerprint(input: FingerprintInput): string;
/**
 * Lookup cached findings by fingerprint.
 *
 * Returns null when:
 *   - cache directory does not exist
 *   - cache file does not exist
 *   - cache file is empty
 *   - cache file is corrupt JSON
 *
 * Throws only when fingerprint is malformed (path traversal attempt).
 */
export declare function lookupCache(workdir: string, fingerprint: string): unknown | null;
/**
 * Write findings to cache. Creates the cache directory if absent.
 * Overwrites existing entry.
 *
 * 並列 reader 安全性: tmp ファイルに書いてから rename (POSIX atomic) — partial
 * write 中の cache file を reader が JSON.parse して null 化する race を回避。
 */
export declare function writeCache(workdir: string, fingerprint: string, data: unknown): void;
/**
 * Invalidate cache. When `fingerprint` is provided, removes only that entry;
 * otherwise removes the entire cache directory.
 *
 * Idempotent: returns silently when cache directory or entry does not exist.
 * `fingerprint` validation は cache dir 存在 check より先に行う (path traversal 早期検出)。
 */
export declare function invalidateCache(workdir: string, fingerprint?: string): void;
//# sourceMappingURL=cr-cache.d.ts.map