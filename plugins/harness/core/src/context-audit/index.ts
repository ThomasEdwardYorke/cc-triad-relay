/**
 * core/src/context-audit/index.ts
 *
 * Context budget audit core engine.
 *
 * 3-gate audit (size / dead-link / committed entry-point) for projects that
 * opt into the context-budget guard. Consumed by:
 *   - `/context-audit` skill (manual invocation, generic shell wrapper)
 *   - Stop hook (`hooks/stop.ts`) — session-end FAIL warning injection
 *   - PreToolUse hook (`guardrails/pre-tool.ts`) — Write redirect suggestion
 *
 * Design:
 *   - **Pure async function**: no side effects beyond filesystem reads. The
 *     consumer decides whether to inject warnings, write logs, or block.
 *   - **Fail-open**: every read error degrades to a `skip` signal. The audit
 *     never throws upstream so a malformed project layout cannot brick a hook.
 *   - **Generic**: directory paths, budget, and entry-point files come from
 *     the resolved `ContextBudgetConfig`. No project-specific literals leak
 *     into this module.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, dirname } from "node:path";

import type { ContextBudgetConfig } from "../config.js";

// ============================================================
// Types
// ============================================================

/** A single 3-gate signal. */
export type ContextAuditSignalId = "size" | "dead-link" | "entry-point";

export type ContextAuditSignalStatus = "pass" | "warn" | "fail" | "skip";

export interface ContextAuditSignal {
  id: ContextAuditSignalId;
  status: ContextAuditSignalStatus;
  /** Short human-readable detail (≤ 200 chars, sanitised for context injection). */
  detail: string;
}

/**
 * Aggregate verdict — strictest signal wins (`fail` > `warn` > `pass`).
 *
 * `skip` is **neutral**: it never elevates the aggregate above whatever the
 * surviving non-skip signals report. A run with all gates `skip`-ed (e.g.
 * an empty-config consumer) therefore returns `pass`. This is intentional —
 * the audit must never report `fail` purely because some gates were skipped
 * (which would conflate "no opinion" with "definitely broken").
 */
export type ContextAuditVerdict = "pass" | "warn" | "fail";

export interface ContextAuditResult {
  verdict: ContextAuditVerdict;
  /** Bit-OR exit code: 0 PASS / 1 size / 2 dead-link / 4 entry-point. */
  exitCode: number;
  signals: ContextAuditSignal[];
  /** Total bytes summed across `autoLoadDirs/**\/*.md`. */
  totalBytes: number;
  /** Configured budget (mirror of `config.budgetBytes`). */
  budgetBytes: number;
  /** `max(0, totalBytes - budgetBytes)`. */
  overBytes: number;
  /** Dead-link paths discovered (relative to project root). */
  deadLinks: string[];
  /** Entry-point files that successfully reference an `onDemandDirs` path. */
  entryPointSources: string[];
}

export interface RunContextAuditOptions {
  projectRoot: string;
  config: ContextBudgetConfig;
}

export interface BudgetPredictionResult {
  /**
   * True iff the write **worsens** the budget posture: `newBytes >= oldBytes`
   * and `predictedTotalBytes > budgetBytes`. **Strict-improvement** edits
   * (`newBytes < oldBytes`) always set `wouldExceed: false`, even when
   * the project is currently over budget — the redirect suggestion targets
   * regressions, not refactors that shrink the auto-load surface. A caller
   * inspecting `marginBytes < 0` will still see the over-budget state in
   * that case; treat `wouldExceed` as the warning trigger and `marginBytes`
   * as the raw budget headroom (positive = under, negative = over).
   */
  wouldExceed: boolean;
  currentTotalBytes: number;
  predictedTotalBytes: number;
  budgetBytes: number;
  /**
   * `budgetBytes - predictedTotalBytes`. Negative when the prediction is
   * over budget. Independent of `wouldExceed`: a strict-improvement edit
   * can still leave a negative margin if the project was already over
   * budget before the edit started.
   */
  marginBytes: number;
  /** True when `filePath` is under any configured `autoLoadDirs`. */
  targetIsAutoLoad: boolean;
}

export interface PredictBudgetImpactOptions {
  projectRoot: string;
  config: ContextBudgetConfig;
  filePath: string;
  newContent: string;
}

// ============================================================
// Path helpers
// ============================================================

/** Normalise the file path for safe directory containment checks. */
function normaliseRelative(filePath: string, projectRoot: string): string | null {
  const root = resolve(projectRoot);
  // `..` segments and absolute paths outside `projectRoot` are rejected.
  const candidate = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

/**
 * Resolve whether a (project-relative or absolute) `filePath` is contained in
 * any of the configured `autoLoadDirs`. Path-traversal entries (`..`) and
 * paths outside the project root are treated as non-matches.
 */
export function isAutoLoadTarget(
  filePath: string,
  autoLoadDirs: string[],
  projectRoot: string,
): boolean {
  const rel = normaliseRelative(filePath, projectRoot);
  if (rel === null) return false;
  for (const dir of autoLoadDirs) {
    const dirRel = normaliseRelative(dir, projectRoot);
    if (dirRel === null) continue;
    // Exact directory or subpath: prefix `${dirRel}/` (or `dirRel` itself
    // when filePath is the directory directly — uncommon but harmless).
    if (rel === dirRel) return true;
    if (rel.startsWith(`${dirRel}/`)) return true;
  }
  return false;
}

/** Collect every `.md` file under each `dir` (relative paths from projectRoot). */
async function collectMarkdownFiles(
  projectRoot: string,
  dirs: string[],
): Promise<string[]> {
  const collected: string[] = [];
  for (const dir of dirs) {
    const dirRel = normaliseRelative(dir, projectRoot);
    if (dirRel === null) continue;
    const absDir = resolve(projectRoot, dirRel);
    if (!existsSync(absDir)) continue;
    await walk(absDir, projectRoot, collected);
  }
  return collected;
}

async function walk(
  absDir: string,
  projectRoot: string,
  out: string[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, projectRoot, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relative(projectRoot, abs));
    }
  }
}

// ============================================================
// Gate 1 — size
// ============================================================

interface SizeGateOutcome {
  signal: ContextAuditSignal;
  totalBytes: number;
  overBytes: number;
}

async function checkSize(
  projectRoot: string,
  autoLoadDirs: string[],
  budgetBytes: number,
): Promise<SizeGateOutcome> {
  const files = await collectMarkdownFiles(projectRoot, autoLoadDirs);
  let total = 0;
  for (const rel of files) {
    try {
      const stat = await fs.stat(resolve(projectRoot, rel));
      total += stat.size;
    } catch {
      // Skip individual file errors — fail-open.
    }
  }
  const over = Math.max(0, total - budgetBytes);
  if (autoLoadDirs.length === 0) {
    return {
      signal: {
        id: "size",
        status: "skip",
        detail: "no autoLoadDirs configured — size gate skipped",
      },
      totalBytes: 0,
      overBytes: 0,
    };
  }
  if (over > 0) {
    return {
      signal: {
        id: "size",
        status: "fail",
        detail: `auto-load total ${total} bytes exceeds budget ${budgetBytes} by ${over} bytes`,
      },
      totalBytes: total,
      overBytes: over,
    };
  }
  return {
    signal: {
      id: "size",
      status: "pass",
      detail: `auto-load total ${total} bytes (budget ${budgetBytes})`,
    },
    totalBytes: total,
    overBytes: 0,
  };
}

// ============================================================
// Gate 2 — dead-link
// ============================================================

interface DeadLinkGateOutcome {
  signal: ContextAuditSignal;
  deadLinks: string[];
}

/**
 * Scan all .md files under `autoLoadDirs` + `onDemandDirs` for relative
 * markdown links. A link is flagged dead when it resolves to a file that
 * does not exist on disk. Anchors (`#section`) and external URLs
 * (`http(s)://`) are ignored.
 *
 * Heuristic: only links pointing at files under any configured
 * `autoLoadDirs` / `onDemandDirs` are checked. A wide pattern would
 * catch unrelated `.md` references in narrative prose; the gate's
 * purpose is to guard the auto-load / on-demand surface specifically.
 */
async function checkDeadLinks(
  projectRoot: string,
  autoLoadDirs: string[],
  onDemandDirs: string[],
): Promise<DeadLinkGateOutcome> {
  const scanFiles = await collectMarkdownFiles(projectRoot, [
    ...autoLoadDirs,
    ...onDemandDirs,
  ]);
  if (scanFiles.length === 0) {
    return {
      signal: {
        id: "dead-link",
        status: "skip",
        detail: "no auto-load / on-demand .md files to scan",
      },
      deadLinks: [],
    };
  }
  const watchedDirs = [...autoLoadDirs, ...onDemandDirs]
    .map((d) => normaliseRelative(d, projectRoot))
    .filter((d): d is string => d !== null);
  const deadLinks: string[] = [];

  // Markdown link `[label](path)` where path is `./...` / `../...` / bare
  // relative. Anchors (`#section`) and absolute URLs are excluded by the
  // regex (`[^)#]+` between `(` and `)` or `#`).
  // 文字列改行 / バックスラッシュ含む不正パスは regex 範囲外で潰し、resolve() に渡さない。
  const linkPattern =
    /\[[^\]]+\]\(\s*([^)\s#]+\.md)(?:#[^)]*)?\s*\)/g;

  for (const rel of scanFiles) {
    let body: string;
    try {
      body = await fs.readFile(resolve(projectRoot, rel), "utf-8");
    } catch {
      continue;
    }
    const matches = body.matchAll(linkPattern);
    for (const m of matches) {
      const linkPath = m[1];
      if (linkPath === undefined) continue;
      // Skip explicit external schemes
      if (/^https?:|^mailto:|^ftp:/i.test(linkPath)) continue;
      // Resolve relative to the current file's directory.
      const fileDir = dirname(resolve(projectRoot, rel));
      const targetAbs = resolve(fileDir, linkPath);
      const targetRel = relative(projectRoot, targetAbs);
      if (targetRel.startsWith("..") || isAbsolute(targetRel)) continue; // outside project
      // Only check links that point under any watched dir — keeps narrative
      // prose noise out of the gate.
      const inWatched = watchedDirs.some(
        (d) => targetRel === d || targetRel.startsWith(`${d}/`),
      );
      if (!inWatched) continue;
      if (!existsSync(targetAbs)) {
        deadLinks.push(`${rel} -> ${targetRel}`);
      }
    }
  }
  if (deadLinks.length === 0) {
    return {
      signal: {
        id: "dead-link",
        status: "pass",
        detail: "no dead links detected",
      },
      deadLinks: [],
    };
  }
  return {
    signal: {
      id: "dead-link",
      status: "fail",
      detail: `${deadLinks.length} dead link(s) detected`,
    },
    deadLinks,
  };
}

// ============================================================
// Gate 3 — committed entry-point
// ============================================================

interface EntryPointGateOutcome {
  signal: ContextAuditSignal;
  entryPointSources: string[];
}

async function checkEntryPoint(
  projectRoot: string,
  entryPointFiles: string[],
  onDemandDirs: string[],
  indexFile: string,
): Promise<EntryPointGateOutcome> {
  if (entryPointFiles.length === 0) {
    return {
      signal: {
        id: "entry-point",
        status: "skip",
        detail: "no entryPointFiles configured — gate skipped",
      },
      entryPointSources: [],
    };
  }
  if (onDemandDirs.length === 0) {
    return {
      signal: {
        id: "entry-point",
        status: "skip",
        detail: "no onDemandDirs configured — entry-point gate skipped",
      },
      entryPointSources: [],
    };
  }
  const sources: string[] = [];
  // For each entry-point file that exists, check whether the body references
  // any onDemandDirs path. We check both literal substrings ("docs/ai-rules")
  // and markdown link forms.
  for (const epRel of entryPointFiles) {
    const epAbs = resolve(projectRoot, epRel);
    if (!existsSync(epAbs)) continue;
    let body: string;
    try {
      body = await fs.readFile(epAbs, "utf-8");
    } catch {
      continue;
    }
    let referenced = false;
    for (const od of onDemandDirs) {
      const odNorm = normaliseRelative(od, projectRoot);
      if (odNorm === null) continue;
      if (body.includes(odNorm)) {
        referenced = true;
        break;
      }
    }
    if (referenced) sources.push(epRel);
  }

  // Optional indexFile existence check — when set, missing index file
  // demotes the gate to WARN even if entry-points pass.
  let indexMissing = false;
  if (indexFile && indexFile.length > 0) {
    const idxAbs = resolve(projectRoot, indexFile);
    if (!existsSync(idxAbs)) indexMissing = true;
  }

  if (sources.length === 0) {
    return {
      signal: {
        id: "entry-point",
        status: "fail",
        detail: `no entryPointFile (${entryPointFiles.join(", ")}) references any onDemandDirs path`,
      },
      entryPointSources: [],
    };
  }
  if (indexMissing) {
    return {
      signal: {
        id: "entry-point",
        status: "warn",
        detail: `entry-point ok (${sources.join(", ")}) but indexFile missing: ${indexFile}`,
      },
      entryPointSources: sources,
    };
  }
  return {
    signal: {
      id: "entry-point",
      status: "pass",
      detail: `entry-point references: ${sources.join(", ")}`,
    },
    entryPointSources: sources,
  };
}

// ============================================================
// Public API
// ============================================================

export async function runContextAudit(
  options: RunContextAuditOptions,
): Promise<ContextAuditResult> {
  const { projectRoot, config } = options;
  const sizeOutcome = await checkSize(
    projectRoot,
    config.autoLoadDirs,
    config.budgetBytes,
  ).catch(
    (err): SizeGateOutcome => ({
      signal: {
        id: "size",
        status: "skip",
        detail: `size gate threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      totalBytes: 0,
      overBytes: 0,
    }),
  );
  const deadLinkOutcome = await checkDeadLinks(
    projectRoot,
    config.autoLoadDirs,
    config.onDemandDirs,
  ).catch(
    (err): DeadLinkGateOutcome => ({
      signal: {
        id: "dead-link",
        status: "skip",
        detail: `dead-link gate threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      deadLinks: [],
    }),
  );
  const entryPointOutcome = await checkEntryPoint(
    projectRoot,
    config.entryPointFiles,
    config.onDemandDirs,
    config.indexFile,
  ).catch(
    (err): EntryPointGateOutcome => ({
      signal: {
        id: "entry-point",
        status: "skip",
        detail: `entry-point gate threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      entryPointSources: [],
    }),
  );

  const signals: ContextAuditSignal[] = [
    sizeOutcome.signal,
    deadLinkOutcome.signal,
    entryPointOutcome.signal,
  ];

  return {
    verdict: aggregateVerdict(signals),
    exitCode: computeExitCode(signals),
    signals,
    totalBytes: sizeOutcome.totalBytes,
    budgetBytes: config.budgetBytes,
    overBytes: sizeOutcome.overBytes,
    deadLinks: deadLinkOutcome.deadLinks,
    entryPointSources: entryPointOutcome.entryPointSources,
  };
}

/**
 * Predict whether writing `newContent` to `filePath` would exceed the
 * `budgetBytes` ceiling.
 */
export async function predictBudgetImpact(
  options: PredictBudgetImpactOptions,
): Promise<BudgetPredictionResult> {
  const { projectRoot, config, filePath, newContent } = options;
  const targetIsAutoLoad = isAutoLoadTarget(
    filePath,
    config.autoLoadDirs,
    projectRoot,
  );
  if (!targetIsAutoLoad) {
    return {
      wouldExceed: false,
      currentTotalBytes: 0,
      predictedTotalBytes: 0,
      budgetBytes: config.budgetBytes,
      marginBytes: config.budgetBytes,
      targetIsAutoLoad: false,
    };
  }
  const sizeOutcome = await checkSize(
    projectRoot,
    config.autoLoadDirs,
    config.budgetBytes,
  );
  const currentTotal = sizeOutcome.totalBytes;
  // If the file already exists, subtract its current byte length so a
  // refactor that strictly *reduces* size never warns.
  const targetAbs = resolve(projectRoot, filePath);
  let oldBytes = 0;
  if (existsSync(targetAbs)) {
    try {
      const stat = await fs.stat(targetAbs);
      oldBytes = stat.size;
    } catch {
      oldBytes = 0;
    }
  }
  const newBytes = Buffer.byteLength(newContent, "utf-8");
  const predicted = currentTotal - oldBytes + newBytes;
  // Strict-improvement short-circuit: an edit that drops the file size
  // never produces a warning, even if the project is currently over budget.
  // The redirect suggestion is for additions that worsen the situation.
  if (newBytes < oldBytes) {
    return {
      wouldExceed: false,
      currentTotalBytes: currentTotal,
      predictedTotalBytes: predicted,
      budgetBytes: config.budgetBytes,
      marginBytes: config.budgetBytes - predicted,
      targetIsAutoLoad: true,
    };
  }
  const wouldExceed = predicted > config.budgetBytes;
  return {
    wouldExceed,
    currentTotalBytes: currentTotal,
    predictedTotalBytes: predicted,
    budgetBytes: config.budgetBytes,
    marginBytes: config.budgetBytes - predicted,
    targetIsAutoLoad: true,
  };
}

// ============================================================
// Pure helpers (exported for tests)
// ============================================================

export function aggregateVerdict(
  signals: ContextAuditSignal[],
): ContextAuditVerdict {
  let verdict: ContextAuditVerdict = "pass";
  for (const s of signals) {
    if (s.status === "fail") return "fail";
    if (s.status === "warn") verdict = "warn";
  }
  return verdict;
}

export function computeExitCode(signals: ContextAuditSignal[]): number {
  let code = 0;
  for (const s of signals) {
    if (s.status !== "fail") continue;
    if (s.id === "size") code |= 1;
    else if (s.id === "dead-link") code |= 2;
    else if (s.id === "entry-point") code |= 4;
  }
  return code;
}
