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
 * (mirrors the same guard in `stop.ts`): raw `\r\n` / `\n` / `\r` /
 * U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR are escaped to the
 * two-character literal `\\n`. The hint strings here are static so this is
 * defense-in-depth, but the contract still holds: any future dynamic
 * content cannot smuggle fake section boundaries.
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

const SOURCE_RESUME_HINT =
  "[SessionStart source=resume] Session resumed from prior state. Re-check your handoff notes and active review context before continuing prior work.";

const SOURCE_COMPACT_HINT =
  "[SessionStart source=compact] Session continued after compaction. PreCompact has already injected relevant project state into earlier context; verify it above before resuming work.";

/**
 * `additionalContext` の単一行 sanitizer。
 *
 * Anthropic 公式 hooks spec (https://code.claude.com/docs/en/hooks) は
 * `additionalContext` の改行 normalize を規定していない (公式 hooks spec
 * 調査で確認)。本 helper は forward-compat hardening として `\r` / `\n` /
 * `\r\n` に加え U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR も
 * literal `\\n` に escape する。
 *
 * U+2028 / U+2029 は ES2019 までは raw JavaScript source で SyntaxError、
 * JSON literal では valid という edge case のため、untrusted dynamic content
 * から smuggling される可能性を pre-emptively 排除する。現状 hint は static
 * literal のみで影響なしだが、将来 dynamic content inject 時の defense-in-depth。
 *
 * 同名 helper が `stop.ts` にも duplicated されているが、関連する別 PR との
 * merge conflict 回避のため本 PR では session-start.ts のみ更新する
 * (stop.ts は後続 follow-up で DRY 共通化予定)。
 *
 * 単体 unit test を可能にするため export している (session-start.test.ts
 * の `describe("sanitizeAdditionalContextLine — Unicode line separator ...")`
 * が直接 invoke する)。
 *
 * Implementation note: regex literal 内では ` ` / ` ` を escape
 * sequence で書く必要がある。raw literal を埋め込むと esbuild / 古い JS
 * parser が syntactic line terminator として扱い `Unterminated regular
 * expression` になる (ES2018 までの仕様)。escape sequence なら source
 * level の line terminator 扱いを回避しつつ、regex match 上は同じ Unicode
 * code point を target にできる。
 */
export function sanitizeAdditionalContextLine(line: string): string {
  return line.replace(/\r\n|[\n\r\u2028\u2029]/g, "\\n");
}

export async function handleSessionStart(
  input: SessionStartInput,
): Promise<SessionStartResult> {
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
