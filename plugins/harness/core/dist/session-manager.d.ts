/**
 * core/src/session-manager.ts
 *
 * Progress aggregator for parallel claude session orchestration.
 *
 * Each per-worktree `claude -p --output-format stream-json` writes its
 * stream-json events to `<logDir>/claude-log-<slug>.jsonl`. This module:
 *
 *   1. Tails / reads those log files (`readSessionLog`).
 *   2. Detects Phase markers in assistant text (`detectPhaseMarker`).
 *   3. Cross-references each worktree's git log (`readGitCommits`).
 *   4. Builds a per-slug summary (`buildSessionSummary`).
 *   5. Renders a coordinator dashboard markdown table (`renderDashboard`).
 *
 * The companion skill `commands/claude-oneshot.md` writes those log files,
 * and downstream coordinator skills fan out N invocations and call
 * `renderDashboard` to display orchestrator state.
 *
 * Implementation is intentionally synchronous and dependency-free so that
 * vitest can drive it from in-memory fixtures without polyfills.
 */
export interface SessionEvent {
    slug: string;
    timestamp: string;
    type: "tool_use" | "phase_marker" | "commit" | "completion" | "error";
    payload: Record<string, unknown>;
}
export interface SessionIdleState {
    severity: "fresh" | "warn" | "fail";
    ageMinutes: number;
    latestActivityTimestamp: string;
    latestEventTimestamp: string | null;
    source: "event" | "commit";
}
export interface SessionSummary {
    slug: string;
    branch: string | null;
    phase: string | null;
    lastCommit: {
        hash: string;
        message: string;
        relativeTime: string;
        timestamp?: string;
    } | null;
    status: "running" | "actionable=0" | "ship" | "merged" | "error" | "unknown";
    idle?: SessionIdleState | null;
    events: SessionEvent[];
}
export declare function detectPhaseMarker(text: string): string | null;
/**
 * Parse a single stream-json line into a SessionEvent.
 *
 * Expected line shape (Anthropic Claude Code stream-json output, per
 * `claude -p --output-format stream-json` documentation):
 *   { "type": "assistant", "message": { "content": [<block>...] }, "timestamp": "..." }
 *   { "type": "result" | "completion", ... }
 *
 * Recognised block shapes:
 *   tool_use:  { "type": "tool_use", "name": "<tool>", "input": {...} }
 *   text:      { "type": "text", "text": "..." }
 *
 * NOTE: This contract is **assumption-based** at module-write time
 * (2026-04-28) — modelled on the documented stream-json schema rather than
 * verified against a live `claude -p` capture. Unrecognised lines are
 * silently dropped (returns null), which is intentional for forward-compat
 * but means an undetected schema drift would manifest as a quiet downgrade
 * to "unknown" status. A future end-to-end smoke test against a live
 * `claude -p` session is the supplementary detector for that drift.
 */
export declare function parseStreamJsonLine(slug: string, line: string, fallbackTimestamp?: string): SessionEvent | null;
export declare function readSessionLog(slug: string, logDir?: string): SessionEvent[];
export declare function readGitCommits(worktreePath: string, limit?: number): {
    hash: string;
    message: string;
    relativeTime: string;
    timestamp?: string;
}[];
export declare function buildSessionSummary(slug: string, opts: {
    logDir?: string;
    worktreePath?: string;
    now?: string | number | Date;
}): SessionSummary;
export declare function renderDashboard(summaries: SessionSummary[]): string;
//# sourceMappingURL=session-manager.d.ts.map