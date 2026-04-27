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
 * `additionalContext` is sanitized through `sanitizeAdditionalContextLine`,
 * which escapes CR / LF / U+2028 / U+2029 to the two-character literal `\\n`
 * to prevent fake section-boundary smuggling. The hint strings here are
 * static, so this is defense-in-depth. The canonical implementation lives
 * in `./_shared/sanitize.ts` and is shared with `stop.ts` and future hooks.
 */
import { sanitizeAdditionalContextLine } from "./_shared/sanitize.js";
// Re-exported for backward compatibility — existing tests import from this
// module by historical convention.
export { sanitizeAdditionalContextLine };
const SOURCE_RESUME_HINT = "[SessionStart source=resume] Session resumed from prior state. Re-check your handoff notes and active review context before continuing prior work.";
const SOURCE_COMPACT_HINT = "[SessionStart source=compact] Session continued after compaction. PreCompact has already injected relevant project state into earlier context; verify it above before resuming work.";
export async function handleSessionStart(input) {
    const source = input.source;
    // Defensive: Anthropic spec says `source` is a non-empty string, but we
    // accept missing / non-string / empty defensively to preserve legacy
    // bare-approve behavior for any payload shape we cannot interpret.
    if (typeof source !== "string" || source.length === 0) {
        return { decision: "approve" };
    }
    switch (source) {
        case "resume":
            return {
                decision: "approve",
                additionalContext: sanitizeAdditionalContextLine(SOURCE_RESUME_HINT),
            };
        case "compact":
            return {
                decision: "approve",
                additionalContext: sanitizeAdditionalContextLine(SOURCE_COMPACT_HINT),
            };
        case "startup":
        case "clear":
        default:
            // Forward-compatible: any unknown future source falls back here.
            return { decision: "approve" };
    }
}
//# sourceMappingURL=session-start.js.map