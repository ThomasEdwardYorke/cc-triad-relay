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
/** Aggregate verdict — strictest signal wins (`fail` > `warn` > `pass`, `skip` neutral). */
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
    /** True iff `totalBytes - oldFileBytes + newContent.byteLength > budgetBytes`. */
    wouldExceed: boolean;
    currentTotalBytes: number;
    predictedTotalBytes: number;
    budgetBytes: number;
    /** Negative when the prediction exceeds the budget. */
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