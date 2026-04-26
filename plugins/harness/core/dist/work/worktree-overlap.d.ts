/**
 * core/src/work/worktree-overlap.ts
 *
 * Static analyzer for `/parallel-worktree` Pre-flight section. Compares the
 * `ownedFiles` / `forbiddenFiles` declarations of multiple sub_tasks to detect
 * editing-territory overlap that would cause merge conflicts during parallel
 * execution.
 *
 * The analyzer is intentionally **purely declarative** — it does not expand
 * glob patterns against the working tree, because:
 *   1. The check runs Pre-flight (before worktrees are populated), so the file
 *      tree is not yet committed in either worktree.
 *   2. The intent is to surface the **declared** territorial boundaries the
 *      author chose, not the runtime file set.
 *   3. Static comparison stays cheap (O(n²) over sub_tasks × patterns), with
 *      no fs / glob library dependencies.
 *
 * Severity heuristic:
 *   - `high`   — exact-literal overlap, OR ≥50% of one task's ownedFiles match.
 *   - `medium` — 1+ partial overlap (single common pattern, or parent/child
 *     glob relationship like `backend/**` ⊃ `backend/api/*`).
 *   - `low`    — only forbidden cross-violations (A.owned listed in B.forbidden
 *     declares "B intends to avoid the area A owns" — useful warning but not
 *     a structural conflict).
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
export declare function detectOverlap(subTasks: readonly SubTaskOverlapInput[]): OverlapReport;
//# sourceMappingURL=worktree-overlap.d.ts.map