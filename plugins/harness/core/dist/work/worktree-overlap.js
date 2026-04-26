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
function patternsOverlap(a, b) {
    if (a === b)
        return true;
    // Parent/child via `**` ancestor: `backend/**` covers `backend/anything`.
    return globContains(a, b) || globContains(b, a);
}
/**
 * True if `parent` (e.g. `backend/**`) covers everything `child` matches
 * (e.g. `backend/api/*`). Pure prefix check on the directory portion before
 * the `**` segment, no real glob expansion.
 */
function globContains(parent, child) {
    const idx = parent.indexOf("**");
    if (idx < 0)
        return false;
    const prefix = parent.slice(0, idx);
    // Parent prefix must align on a directory boundary; otherwise `front**` would
    // be considered a parent of `frontXxx` which is wrong.
    if (prefix.length > 0 && !prefix.endsWith("/"))
        return false;
    if (!child.startsWith(prefix))
        return false;
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
function intersectPatterns(a, b) {
    const seen = new Set();
    const out = [];
    for (const pa of a) {
        if (seen.has(pa))
            continue;
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
function detectForbiddenViolations(a, b) {
    const out = [];
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
function classifySeverity(overlappingPatternsFromA, overlappingPatternsFromB, a, b, forbiddenViolations) {
    // Either side reporting overlapping patterns means the pair has owned overlap.
    if (overlappingPatternsFromA.length > 0 ||
        overlappingPatternsFromB.length > 0) {
        // Exact-literal overlap (両側に同一の pattern が直接 declare されている)
        const hasExact = overlappingPatternsFromA.some((p) => a.ownedFiles.includes(p) && b.ownedFiles.includes(p));
        // Coverage on each side independently. A-side counts how many of A's
        // declared patterns overlap something in B; B-side does the symmetric
        // check (B's patterns vs A). Using A-side count for B-side coverage
        // would under-report asymmetric cases like `A=["shared/**","x.ts"]` vs
        // `B=["shared/a.ts","shared/b.ts","x.ts"]` where every B pattern is
        // covered by A but A only contributes 2 patterns to the intersection.
        const aCoverage = a.ownedFiles.length > 0
            ? overlappingPatternsFromA.length / a.ownedFiles.length
            : 0;
        const bCoverage = b.ownedFiles.length > 0
            ? overlappingPatternsFromB.length / b.ownedFiles.length
            : 0;
        // high: 直接 literal match があり、かつ片側 coverage が 50% を**厳密に**超える。
        //       50% 丁度 (1 pattern in 2-element array) は medium 扱い。
        if (hasExact && (aCoverage > 0.5 || bCoverage > 0.5))
            return "high";
        // 親子 glob のみ / 50% 丁度の exact match / その他 owned overlap → medium
        return "medium";
    }
    if (forbiddenViolations.length > 0)
        return "low";
    // 到達不可だが defensive (caller が overlap なし pair を omit する想定)
    return "low";
}
/**
 * Top-level recommendation derived from severity counts.
 */
function decideRecommendation(highCount, mediumCount) {
    if (highCount > 0)
        return "consolidate-into-single-pr";
    if (mediumCount > 0)
        return "serialize";
    return "parallel-ok";
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function detectOverlap(subTasks) {
    // Invariant: slug must be unique. Duplicate → fail-fast.
    const seenSlugs = new Set();
    for (const task of subTasks) {
        if (seenSlugs.has(task.slug)) {
            throw new Error(`detectOverlap: duplicate slug '${task.slug}' (each sub_task must have a unique slug).`);
        }
        seenSlugs.add(task.slug);
    }
    const pairs = [];
    for (let i = 0; i < subTasks.length; i++) {
        for (let j = i + 1; j < subTasks.length; j++) {
            const a = subTasks[i];
            const b = subTasks[j];
            // ownedFiles 空のタスクは pair 計算対象外。
            if (a.ownedFiles.length === 0 || b.ownedFiles.length === 0)
                continue;
            // 両方向の overlap を取得する: A 側 (A の patterns が B と被るか) と
            // B 側 (B の patterns が A と被るか)。非対称ケース (e.g. A=["shared/**","x.ts"]
            // vs B=["shared/a.ts","shared/b.ts","x.ts"]) で B 側 coverage を A 側 count で
            // 過小評価する bug を防ぐため、severity 判定では両側を独立に算出する。
            const overlappingFromA = intersectPatterns(a.ownedFiles, b.ownedFiles);
            const overlappingFromB = intersectPatterns(b.ownedFiles, a.ownedFiles);
            const forbidden = detectForbiddenViolations(a, b);
            if (overlappingFromA.length === 0 &&
                overlappingFromB.length === 0 &&
                forbidden.length === 0)
                continue;
            const severity = classifySeverity(overlappingFromA, overlappingFromB, a, b, forbidden);
            // OverlapPair.overlappingPatterns には両側 union (重複除去) を返却。
            // これにより consumer は「A 側 / B 側どちらの観点でも overlap している全 pattern」を
            // 1 list で参照できる (asymmetric case で union のほうが情報量が多い)。
            const unionPatterns = [];
            const seen = new Set();
            for (const p of [...overlappingFromA, ...overlappingFromB]) {
                if (!seen.has(p)) {
                    seen.add(p);
                    unionPatterns.push(p);
                }
            }
            pairs.push({
                taskA: a.slug,
                taskB: b.slug,
                overlappingPatterns: unionPatterns,
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
//# sourceMappingURL=worktree-overlap.js.map