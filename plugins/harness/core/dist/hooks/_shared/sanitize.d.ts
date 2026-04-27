/**
 * hooks/_shared/sanitize.ts
 *
 * Shared string sanitizer for hook payload fields such as
 * `additionalContext` and `stopReason`.
 *
 * Escapes CR / LF and Unicode line separators (U+2028 / U+2029)
 * to the two-character literal `\\n` to prevent fake section-boundary
 * smuggling when downstream consumers (LLM context assembly, JSONL
 * pipelines) split on raw line terminators.
 *
 * Implementation note: the regex literal uses Unicode escape sequences
 * (
 /
) rather than raw code points because embedding the
 * raw characters causes esbuild and older JS parsers to treat them as
 * syntactic line terminators and reject the source as unterminated
 * (ES2018 spec).
 */
/**
 * Sanitizes a string by escaping CR / LF and Unicode line separators
 * (U+2028 / U+2029) to the two-character literal `\\n`.
 *
 * Used by `session-start.ts` and `stop.ts` to ensure hook payloads
 * do not contain raw line breaks that could smuggle fake section
 * boundaries into `additionalContext` or other fields consumed by
 * downstream LLM context assembly.
 *
 * @param line - Input string (may contain raw line terminators)
 * @returns Sanitized string with all line terminators escaped to `\\n`
 *
 * @example
 * sanitizeAdditionalContextLine("a\nb")    // -> "a\\nb"
 * sanitizeAdditionalContextLine("a\r\nb")  // -> "a\\nb"
 */
export declare function sanitizeAdditionalContextLine(line: string): string;
//# sourceMappingURL=sanitize.d.ts.map