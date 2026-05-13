/**
 * core/src/work/worktree-overlap.ts
 *
 * Static analyzer for `/parallel-worktree` Pre-flight section. Compares the
 * `ownedFiles` / `forbiddenFiles` declarations of multiple sub_tasks to detect
 * editing-territory overlap that would cause merge conflicts during parallel
 * execution.
 *
 * Pattern language (restricted, NOT full glob):
 *
 *   - Literal POSIX paths: 'src/api/foo.ts', 'backend/models.py'.
 *   - Territory patterns:  'backend/' followed by double-star (covers all
 *     paths under backend/). The double-star MUST be the trailing segment.
 *   - NOT supported: single-star wildcards ('src/' star '.ts',
 *     star '.test.ts'), suffix-bearing double-star
 *     ('src/' double-star '/test.ts'), character classes,
 *     question-mark placeholders, Windows backslashes, leading './',
 *     double slashes, trailing whitespace.
 *
 * (literal asterisks in pattern examples are spelled out as 'star' /
 * 'double-star' inside this JSDoc to avoid prematurely terminating the
 * comment block.)
 *
 * Unsupported patterns are **rejected at input validation time** (`detectOverlap`
 * throws). This is a deliberate API contract: full glob semantics would require
 * a glob library and runtime fs comparison, which contradicts the declarative
 * Pre-flight phase design (worktrees are not yet populated). Authors who need
 * fine-grained file selection should declare literal paths; authors who need
 * broad territory coverage should use a trailing double-star territory
 * pattern. Anything in between (e.g., "all files matching star-dot-test-dot-ts")
 * is out of scope for this analyzer.
 *
 * The analyzer is intentionally **purely declarative** — it does not expand
 * patterns against the working tree, because:
 *   1. The check runs Pre-flight (before worktrees are populated), so the file
 *      tree is not yet committed in either worktree.
 *   2. The intent is to surface the **declared** territorial boundaries the
 *      author chose, not the runtime file set.
 *   3. Static comparison stays cheap (O(n²) over sub_tasks × patterns), with
 *      no fs / glob library dependencies.
 *
 * Severity heuristic (実装と完全一致):
 *   - `high`   — owned overlap が exact-literal を含み、かつ A 側または B 側
 *     coverage の **どちらかが strictly > 50%** (50% 丁度は medium 扱い)。
 *   - `medium` — owned overlap あり、かつ `high` 条件を満たさない全ケース。
 *     具体的には:
 *       (a) exact-literal overlap だが coverage ≤ 50% (例: 1 pattern in 2-element array)
 *       (b) 親子 glob 関係のみ (`backend/**` ⊃ `backend/api/*` 等)
 *       (c) その他 owned overlap が存在する全ケース (high 条件外の余事象)
 *   - `low`    — owned overlap なし、forbidden cross-violation のみ
 *     (A.owned listed in B.forbidden declares "B intends to avoid the area
 *     A owns" — useful warning but not a structural conflict)。
 *
 * Recommendation:
 *   - any `high` → `consolidate-into-single-pr` (merge conflict near-guaranteed)
 *   - any `medium` (no high) → `serialize` (set merge_priority + run sequentially)
 *   - all `low` / no overlap → `parallel-ok`
 */
export interface SubTaskOverlapInput {
    /** Unique identifier across the input array. Duplicate slugs throw. */
    slug: string;
    /**
     * Glob patterns the task is allowed to edit. Empty array → task contributes
     * no editable territory and is skipped during pair analysis.
     */
    ownedFiles: string[];
    /**
     * Optional glob patterns the task explicitly should not edit. Used to detect
     * "B forbids what A owns" cross-violations (low severity warning).
     */
    forbiddenFiles?: string[];
}
export interface ForbiddenViolation {
    /** Task whose ownedFiles include the conflicting pattern. */
    from: string;
    /** Task whose forbiddenFiles include the conflicting pattern. */
    to: string;
    /** The pattern that triggers the cross-violation. */
    pattern: string;
}
export interface OverlapPair {
    taskA: string;
    taskB: string;
    /** Common owned glob patterns (literal-equal or parent/child related). */
    overlappingPatterns: string[];
    forbiddenViolations: ForbiddenViolation[];
    severity: "high" | "medium" | "low";
}
export interface OverlapSummary {
    totalPairs: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    /** Recommended action for the parallel run. */
    recommendation: "parallel-ok" | "serialize" | "consolidate-into-single-pr";
}
export interface OverlapReport {
    pairs: OverlapPair[];
    summary: OverlapSummary;
}
export interface DynamicChangedPathInput {
    /**
     * Stable identifier surfaced in merge-train output (e.g. current PR,
     * remaining PR, or worktree slug). Must be unique across the comparison.
     */
    id: string;
    /**
     * Concrete relative file paths collected from a merge-base-aware diff
     * (`git diff --name-only <merge-base>...HEAD`). This helper compares exact
     * changed paths only; it does not run git and it does not expand globs.
     */
    changedFiles: readonly string[];
}
export interface DynamicChangedPathOverlapPair {
    currentId: string;
    otherId: string;
    overlappingFiles: string[];
}
export interface DynamicChangedPathOverlapReport {
    currentId: string;
    blocking: boolean;
    pairs: DynamicChangedPathOverlapPair[];
    overlappingFiles: string[];
}
export declare function detectOverlap(subTasks: readonly SubTaskOverlapInput[]): OverlapReport;
/**
 * Runtime merge-train guard: compare concrete changed paths for the PR about to
 * be merged against every remaining PR/worktree. Inputs should already be
 * collected by the caller from merge-base-aware diffs; this helper stays pure
 * and deterministic so it can be unit-tested without live git, GitHub, or tmux.
 */
export declare function detectDynamicChangedPathOverlap(current: DynamicChangedPathInput, remaining: readonly DynamicChangedPathInput[]): DynamicChangedPathOverlapReport;
//# sourceMappingURL=worktree-overlap.d.ts.map