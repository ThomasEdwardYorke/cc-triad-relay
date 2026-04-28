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
import type { ContextBudgetConfig } from "../config.js";
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
/**
 * Resolve whether a (project-relative or absolute) `filePath` is contained in
 * any of the configured `autoLoadDirs`. Path-traversal entries (`..`) and
 * paths outside the project root are treated as non-matches.
 */
export declare function isAutoLoadTarget(filePath: string, autoLoadDirs: string[], projectRoot: string): boolean;
export declare function runContextAudit(options: RunContextAuditOptions): Promise<ContextAuditResult>;
/**
 * Predict whether writing `newContent` to `filePath` would exceed the
 * `budgetBytes` ceiling.
 */
export declare function predictBudgetImpact(options: PredictBudgetImpactOptions): Promise<BudgetPredictionResult>;
export declare function aggregateVerdict(signals: ContextAuditSignal[]): ContextAuditVerdict;
export declare function computeExitCode(signals: ContextAuditSignal[]): number;
//# sourceMappingURL=index.d.ts.map