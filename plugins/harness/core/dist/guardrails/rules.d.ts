/**
 * core/src/guardrails/rules.ts
 * Declarative guardrail rule table.
 *
 * Each rule is a (toolPattern, evaluate) pair that returns a HookResult
 * when it fires, or null to pass through to the next rule.
 *
 * Rules R01–R09 and R12 are domain-neutral. R10, R11, R13 are driven by
 * `harness.config.json` and no-op when their configuration arrays are
 * empty, so the distribution is entirely project-agnostic by default.
 */
import type { GuardRule, HookResult, RuleContext } from "../types.js";
/**
 * Split a command line into segments on shell separators (`;`, `&`, `|`),
 * ignoring separators that are quoted or backslash-escaped.
 *
 * A lexical split would treat `cat 'prod;backup.env'` as two commands and let
 * a genuine protected read through, so quoting has to be tracked. This is a
 * boundary finder, not a shell parser: it only needs to know where one command
 * ends, and it errs toward keeping text together (an unterminated quote or an
 * unbalanced `(` yields one segment, which is the conservative direction for a
 * deny rule — fewer splits can only widen a deny, never open one).
 *
 * Three constructs make a separator character not a boundary:
 *
 * | construct | example that must stay one segment |
 * |---|---|
 * | quoted / escaped | `cat 'prod;backup.env'`, `cat prod\;backup.env` |
 * | ANSI-C quoting `$'…'` | `cat $'prod\';backup.env'` |
 * | expansion `$( … )`, `$(( … ))`, `` ` … ` `` | `cat $(printf foo \| tr o a) .env` |
 */
export declare function splitOnUnquotedSeparators(command: string): string[];
export declare const GUARD_RULES: readonly GuardRule[];
/**
 * Evaluate all rules in order. Return the first non-null result, or
 * { decision: "approve" } if no rule fired.
 */
export declare function evaluateRules(ctx: RuleContext): HookResult;
//# sourceMappingURL=rules.d.ts.map