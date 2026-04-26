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
  recommendation:
    | "parallel-ok"
    | "serialize"
    | "consolidate-into-single-pr";
}

export interface OverlapReport {
  pairs: OverlapPair[];
  summary: OverlapSummary;
}

// ---------------------------------------------------------------------------
// Pattern comparison
// ---------------------------------------------------------------------------

/**
 * Check if two glob patterns overlap (one contains or equals the other).
 * Static heuristic — no glob library, no fs access.
 *
 * - Literal equality                   → exact match
 * - One pattern is a `**` ancestor     → parent/child match (e.g.
 *   `backend/**` covers `backend/api/*`)
 * - Otherwise                          → no overlap
 */
function patternsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  // Parent/child via `**` ancestor: `backend/**` covers `backend/anything`.
  return globContains(a, b) || globContains(b, a);
}

/**
 * True if `parent` (e.g. `backend/**`) covers everything `child` matches
 * (e.g. `backend/api/*`). Pure prefix check on the directory portion before
 * the `**` segment, no real glob expansion.
 */
function globContains(parent: string, child: string): boolean {
  const idx = parent.indexOf("**");
  if (idx < 0) return false;
  const prefix = parent.slice(0, idx);
  // Parent prefix must align on a directory boundary; otherwise `front**` would
  // be considered a parent of `frontXxx` which is wrong.
  if (prefix.length > 0 && !prefix.endsWith("/")) return false;
  if (!child.startsWith(prefix)) return false;
  // Child should describe a deeper or equal scope. If both contain `**`, the
  // longer prefix is the more specific one — only the shorter prefix counts as
  // an ancestor (avoids self-reporting `backend/**` ⊃ `backend/**`).
  return parent !== child;
}

/**
 * Compute overlapping patterns between two ownedFiles arrays. Each pattern in A
 * that overlaps any pattern in B (via patternsOverlap) is added once. Order
 * follows A's declaration; deduplicated to avoid `["foo", "foo"]` artifacts.
 */
function intersectPatterns(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pa of a) {
    if (seen.has(pa)) continue;
    if (b.some((pb) => patternsOverlap(pa, pb))) {
      seen.add(pa);
      out.push(pa);
    }
  }
  return out;
}

/**
 * Forbidden cross-violations between A and B (in both directions):
 *   - A.owned ⊆ B.forbidden  → recorded as { from: A.slug, to: B.slug }
 *   - B.owned ⊆ A.forbidden  → recorded as { from: B.slug, to: A.slug }
 *
 * Uses the same pattern-overlap heuristic as ownedFiles comparison.
 */
function detectForbiddenViolations(
  a: SubTaskOverlapInput,
  b: SubTaskOverlapInput,
): ForbiddenViolation[] {
  const out: ForbiddenViolation[] = [];
  const aForbidden = a.forbiddenFiles ?? [];
  const bForbidden = b.forbiddenFiles ?? [];
  for (const owned of a.ownedFiles) {
    for (const forbidden of bForbidden) {
      if (patternsOverlap(owned, forbidden)) {
        out.push({ from: a.slug, to: b.slug, pattern: owned });
      }
    }
  }
  for (const owned of b.ownedFiles) {
    for (const forbidden of aForbidden) {
      if (patternsOverlap(owned, forbidden)) {
        out.push({ from: b.slug, to: a.slug, pattern: owned });
      }
    }
  }
  return out;
}

/**
 * Severity classification for a single pair.
 *   - high   — exact-literal overlap OR overlap covers ≥50% of either side
 *   - medium — 1+ partial overlapping pattern (no high condition met)
 *   - low    — only forbidden violations (no owned overlap)
 */
function classifySeverity(
  overlappingPatterns: string[],
  a: SubTaskOverlapInput,
  b: SubTaskOverlapInput,
  forbiddenViolations: ForbiddenViolation[],
): "high" | "medium" | "low" {
  if (overlappingPatterns.length > 0) {
    // Exact-literal overlap (両側に同一の pattern が直接 declare されている)
    const hasExact = overlappingPatterns.some(
      (p) => a.ownedFiles.includes(p) && b.ownedFiles.includes(p),
    );
    // Coverage on either side, strictly > 50% (50% 丁度は medium 扱い)
    const aCoverage =
      a.ownedFiles.length > 0
        ? overlappingPatterns.length / a.ownedFiles.length
        : 0;
    const bCoverage =
      b.ownedFiles.length > 0
        ? overlappingPatterns.length / b.ownedFiles.length
        : 0;
    // high: 直接 literal match があり、かつ片側 coverage が 50% 超え
    //       (exact match のみで coverage が低い場合 = 共通 file 1 件が大きな array に
    //       散らばっている = 部分競合 → medium)
    if (hasExact && (aCoverage > 0.5 || bCoverage > 0.5)) return "high";
    // 親子 glob のみ / 50% 丁度の exact match → medium
    return "medium";
  }
  if (forbiddenViolations.length > 0) return "low";
  // 到達不可だが defensive (caller が overlap なし pair を omit する想定)
  return "low";
}

/**
 * Top-level recommendation derived from severity counts.
 */
function decideRecommendation(
  highCount: number,
  mediumCount: number,
): OverlapSummary["recommendation"] {
  if (highCount > 0) return "consolidate-into-single-pr";
  if (mediumCount > 0) return "serialize";
  return "parallel-ok";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectOverlap(
  subTasks: readonly SubTaskOverlapInput[],
): OverlapReport {
  // Invariant: slug must be unique. Duplicate → fail-fast.
  const seenSlugs = new Set<string>();
  for (const task of subTasks) {
    if (seenSlugs.has(task.slug)) {
      throw new Error(
        `detectOverlap: duplicate slug '${task.slug}' (each sub_task must have a unique slug).`,
      );
    }
    seenSlugs.add(task.slug);
  }

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < subTasks.length; i++) {
    for (let j = i + 1; j < subTasks.length; j++) {
      const a = subTasks[i]!;
      const b = subTasks[j]!;
      // ownedFiles 空のタスクは pair 計算対象外。
      if (a.ownedFiles.length === 0 || b.ownedFiles.length === 0) continue;
      const overlapping = intersectPatterns(a.ownedFiles, b.ownedFiles);
      const forbidden = detectForbiddenViolations(a, b);
      if (overlapping.length === 0 && forbidden.length === 0) continue;
      const severity = classifySeverity(overlapping, a, b, forbidden);
      pairs.push({
        taskA: a.slug,
        taskB: b.slug,
        overlappingPatterns: overlapping,
        forbiddenViolations: forbidden,
        severity,
      });
    }
  }

  const highCount = pairs.filter((p) => p.severity === "high").length;
  const mediumCount = pairs.filter((p) => p.severity === "medium").length;
  const lowCount = pairs.filter((p) => p.severity === "low").length;

  return {
    pairs,
    summary: {
      totalPairs: pairs.length,
      highCount,
      mediumCount,
      lowCount,
      recommendation: decideRecommendation(highCount, mediumCount),
    },
  };
}
