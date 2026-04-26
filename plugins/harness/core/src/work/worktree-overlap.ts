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
// Pattern validation (input contract enforcement)
// ---------------------------------------------------------------------------

/**
 * Validate a single pattern against the restricted language. Throws Error with
 * an actionable message on first violation. See file-head doc comment for the
 * supported / unsupported pattern list.
 *
 * Rationale: silently accepting unsupported patterns produced false negatives
 * (a single-star wildcard pattern like 'src/' star '.ts' vs a literal
 * 'src/foo.ts' was not detected) and false positives (a suffix-bearing
 * double-star pattern like 'src/' double-star '/test.ts' incorrectly marked
 * 'src/README.md' as covered). Rejecting at input time is the only
 * correctness-preserving option without pulling in a glob library.
 */
function validatePattern(pattern: string, slug: string, field: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(
      `detectOverlap: ${field} pattern (slug='${slug}') is empty or non-string. ` +
        `Use a literal POSIX path or a 'dir/**' territory pattern.`,
    );
  }
  if (pattern !== pattern.trim()) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') has leading/trailing whitespace. ` +
        `Trim the pattern.`,
    );
  }
  if (pattern.includes("\\")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') contains a backslash. ` +
        `Use forward slashes only (POSIX paths).`,
    );
  }
  if (pattern.includes("//")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') contains consecutive slashes. ` +
        `Normalize to single '/' separators.`,
    );
  }
  if (pattern === "." || pattern === "./" || pattern.startsWith("./")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') uses leading './'. ` +
        `Drop the './' prefix.`,
    );
  }
  if (pattern.includes("?")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') uses '?' wildcard which is not supported. ` +
        `Only literal paths and 'dir/**' territory patterns are supported.`,
    );
  }
  if (pattern.includes("[")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') uses '[' character class which is not supported. ` +
        `Only literal paths and 'dir/**' territory patterns are supported.`,
    );
  }
  // Wildcard rules:
  //   1. `**` is allowed only as a trailing segment (`dir/**` or `dir/**/`).
  //   2. Single-star `*` (NOT part of `**`) is forbidden anywhere.
  //   3. `**` followed by a non-trailing segment (`dir/**/file.ts`, `**/test.ts`) is forbidden.
  // Logic: remove all valid `**` occurrences (only those at the very end), then
  // verify no `*` remains. This rejects every unsupported `*` form including
  // `src/*.ts`, `*.test.ts`, `src/**/test.ts`, `**/foo.ts`.
  const stripped = stripValidDoubleStar(pattern);
  if (stripped.includes("*")) {
    throw new Error(
      `detectOverlap: ${field} pattern '${pattern}' (slug='${slug}') uses an unsupported wildcard form. ` +
        `Only literal paths and trailing 'dir/**' territory patterns are supported (no 'src/*.ts', no 'dir/**/file.ts', no '**/foo.ts').`,
    );
  }
}

/**
 * Remove valid trailing double-star occurrences from the pattern.
 * A valid trailing double-star takes one of three shapes:
 *
 *   - 'dir/' followed by double-star (the double-star IS the last segment)
 *   - 'dir/' followed by double-star and slash (last segment then trailing /)
 *   - exactly the double-star alone (root territory; rare but technically valid)
 *
 * Anything else (e.g., 'dir/' double-star '/foo' or double-star '/foo.ts')
 * is invalid. After stripping the valid form, the caller checks for any
 * remaining single star, which would indicate an unsupported wildcard.
 */
function stripValidDoubleStar(pattern: string): string {
  if (pattern === "**") return "";
  if (pattern.endsWith("/**")) return pattern.slice(0, -3);
  if (pattern.endsWith("/**/")) return pattern.slice(0, -4);
  return pattern;
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
  overlappingPatternsFromA: string[],
  overlappingPatternsFromB: string[],
  a: SubTaskOverlapInput,
  b: SubTaskOverlapInput,
  forbiddenViolations: ForbiddenViolation[],
): "high" | "medium" | "low" {
  // Either side reporting overlapping patterns means the pair has owned overlap.
  if (
    overlappingPatternsFromA.length > 0 ||
    overlappingPatternsFromB.length > 0
  ) {
    // Exact-literal overlap (両側に同一の pattern が直接 declare されている)
    const hasExact = overlappingPatternsFromA.some(
      (p) => a.ownedFiles.includes(p) && b.ownedFiles.includes(p),
    );
    // Coverage on each side independently. A-side counts how many of A's
    // declared patterns overlap something in B; B-side does the symmetric
    // check (B's patterns vs A). Using A-side count for B-side coverage
    // would under-report asymmetric cases like `A=["shared/**","x.ts"]` vs
    // `B=["shared/a.ts","shared/b.ts","x.ts"]` where every B pattern is
    // covered by A but A only contributes 2 patterns to the intersection.
    const aCoverage =
      a.ownedFiles.length > 0
        ? overlappingPatternsFromA.length / a.ownedFiles.length
        : 0;
    const bCoverage =
      b.ownedFiles.length > 0
        ? overlappingPatternsFromB.length / b.ownedFiles.length
        : 0;
    // high: 直接 literal match があり、かつ片側 coverage が 50% を**厳密に**超える。
    //       50% 丁度 (1 pattern in 2-element array) は medium 扱い。
    if (hasExact && (aCoverage > 0.5 || bCoverage > 0.5)) return "high";
    // 親子 glob のみ / 50% 丁度の exact match / その他 owned overlap → medium
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
    // Input validation: every pattern must conform to the restricted language
    // (see file-head doc + validatePattern). Done eagerly so callers see a
    // clear error before any pair analysis runs.
    for (const pattern of task.ownedFiles) {
      validatePattern(pattern, task.slug, "ownedFiles");
    }
    if (task.forbiddenFiles) {
      for (const pattern of task.forbiddenFiles) {
        validatePattern(pattern, task.slug, "forbiddenFiles");
      }
    }
  }

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < subTasks.length; i++) {
    for (let j = i + 1; j < subTasks.length; j++) {
      const a = subTasks[i]!;
      const b = subTasks[j]!;
      // ownedFiles 空のタスクは pair 計算対象外。
      if (a.ownedFiles.length === 0 || b.ownedFiles.length === 0) continue;
      // 両方向の overlap を取得する: A 側 (A の patterns が B と被るか) と
      // B 側 (B の patterns が A と被るか)。非対称ケース (e.g. A=["shared/**","x.ts"]
      // vs B=["shared/a.ts","shared/b.ts","x.ts"]) で B 側 coverage を A 側 count で
      // 過小評価する bug を防ぐため、severity 判定では両側を独立に算出する。
      const overlappingFromA = intersectPatterns(a.ownedFiles, b.ownedFiles);
      const overlappingFromB = intersectPatterns(b.ownedFiles, a.ownedFiles);
      const forbidden = detectForbiddenViolations(a, b);
      if (
        overlappingFromA.length === 0 &&
        overlappingFromB.length === 0 &&
        forbidden.length === 0
      ) continue;
      const severity = classifySeverity(
        overlappingFromA,
        overlappingFromB,
        a,
        b,
        forbidden,
      );
      // OverlapPair.overlappingPatterns には両側 union (重複除去) を返却。
      // これにより consumer は「A 側 / B 側どちらの観点でも overlap している全 pattern」を
      // 1 list で参照できる (asymmetric case で union のほうが情報量が多い)。
      const unionPatterns: string[] = [];
      const seen = new Set<string>();
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
