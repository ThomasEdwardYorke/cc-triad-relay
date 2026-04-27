/**
 * hooks/session-start.ts
 *
 * SessionStart hook handler.
 *
 * Anthropic Claude Code's SessionStart hook fires whenever a session begins.
 * The `source` field (https://code.claude.com/docs/en/hooks) distinguishes
 * how the session began:
 *
 *   - `startup` : brand-new session (first launch in this cwd)
 *   - `resume`  : continuation of a previous session (file-backed resume)
 *   - `clear`   : continuation after `/clear` (in-memory reset)
 *   - `compact` : continuation after compaction (PreCompact-driven trim)
 *
 * For source values that imply "not starting fresh" (`resume` / `compact`),
 * we inject a small `additionalContext` hint so Claude knows to consult
 * prior session artifacts (handoff docs / Plans.md / open PRs) instead of
 * starting work in a vacuum. For `startup` and `clear`, we return a bare
 * approve to preserve the legacy behavior — those sources are intentional
 * fresh starts and the user should not be nudged toward stale context.
 *
 * Forward-compatible by design: unknown / non-string / missing source
 * values fall back to bare approve so any future Anthropic source addition
 * cannot break the hook chain. The `default` switch arm enforces this.
 *
 * ## Cooperation with PreCompact
 *
 * `hooks/pre-compact.ts` already injects rich project state (assignment
 * table, open PRs, custom_instructions) into `additionalContext` before
 * compaction. The `source=compact` path here intentionally stays light —
 * a one-line nudge to double-check that pre-compaction state. We avoid
 * duplicating PreCompact's payload to keep the post-compaction context
 * window lean.
 *
 * ## Sanitization
 *
 * `additionalContext` is sanitized through `sanitizeAdditionalContextLine`
 * (mirrors the same guard in `stop.ts`): raw `\r\n` / `\n` / `\r` are
 * escaped to the two-character literal `\\n`. The hint strings here are
 * static so this is defense-in-depth, but the contract still holds: any
 * future dynamic content cannot smuggle fake section boundaries.
 */
export interface SessionStartInput {
    hook_event_name: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    /**
     * Anthropic SessionStart spec field — one of
     * `"startup" | "resume" | "clear" | "compact"`. We accept `string`
     * (rather than a literal union) because future Anthropic releases
     * may add new sources, and our handler must fall back gracefully
     * rather than throw.
     */
    source?: string | undefined;
}
export interface SessionStartResult {
    decision: "approve";
    additionalContext?: string;
}
export declare function handleSessionStart(input: SessionStartInput): Promise<SessionStartResult>;
//# sourceMappingURL=session-start.d.ts.map