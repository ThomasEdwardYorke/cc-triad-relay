/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Reads project config via
 * `loadConfigWithError` so that partial `work.qualityGates` overrides
 * inherit the other gate defaults **and** so that a malformed config
 * file is not silently treated the same as a pristine config — a
 * broken file suppresses the reminders entirely (avoids the
 * silent-swallow failure mode where `loadConfigSafe` would emit every
 * default reminder even when the user never validly authored them).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigWithError } from "../config.js";
import { runContextAudit } from "../context-audit/index.js";
import { sanitizeAdditionalContextLine } from "./_shared/sanitize.js";
export async function handleStop(input) {
    const projectRoot = input.cwd ?? process.cwd();
    // Anthropic Claude Code Stop hook spec (https://code.claude.com/docs/en/hooks):
    // `stop_hook_active === true` 時は再帰起動防止のため全 reminder を抑止し
    // bare approve に落ちる。subagent-stop の guard と同 pattern (公式 hooks
    // spec で SubagentStop と同一 semantics と確認済)。existsSync(configPath)
    // チェックよりも前に置くことで、config 評価とは独立して uniform に
    // short-circuit する (config 在不在で動作差なし)。
    if (input.stop_hook_active === true) {
        return { decision: "approve" };
    }
    // Keep the historical behavior of returning a bare approve when the
    // project has no `harness.config.json` at all — we don't want to
    // start emitting reminders for projects that never opted in.
    const configPath = resolve(projectRoot, "harness.config.json");
    if (!existsSync(configPath)) {
        return { decision: "approve" };
    }
    const outcome = loadConfigWithError(projectRoot);
    if (outcome.error !== undefined) {
        // Malformed config. Emitting the default reminder set ("TDD 必須 /
        // 疑似 CodeRabbit 必須 / ...") would misrepresent the project's
        // intent — the user never successfully declared them. Surface the
        // parse failure to stderr and suppress all reminders for this turn.
        process.stderr.write(`[harness stop] harness.config.json parse failed: ${outcome.error}; suppressing quality-gate reminders until fixed.\n`);
        return { decision: "approve" };
    }
    const gates = outcome.config.work.qualityGates;
    const reminders = [];
    if (gates.enforceTddImplement) {
        reminders.push("TDD 必須");
    }
    if (gates.enforcePseudoCoderabbit) {
        reminders.push("疑似 CodeRabbit 必須");
    }
    if (gates.enforceRealCoderabbit) {
        reminders.push("本物 CodeRabbit 必須");
    }
    if (gates.enforceCodexSecondOpinion) {
        reminders.push("Codex セカンドオピニオン必須");
    }
    // The phase-specific gates above mirror the four formal review phases.
    // The `harness-work-essence` gate is orthogonal and surfaces the
    // workflow-wide invariants (broad scope, structured Codex team, TDD
    // loop, never-give-up, no-leak-of-nitpicks, end-of-session handoff
    // archive/update). It ships as a separate `additionalContext` block so
    // the historical `[品質ゲート]` line stays unchanged for projects that
    // do not opt in.
    const sections = [];
    if (reminders.length > 0) {
        sections.push(sanitizeAdditionalContextLine(`[品質ゲート] ${reminders.join(" / ")}`));
    }
    if (gates.enforceHarnessWorkEssence) {
        sections.push(sanitizeAdditionalContextLine("[harness-work essence] broad scope / structured team + Codex parallel / TDD (Red->Green->Refactor) / never give up / address every minor finding / end-of-session handoff archive+update — details: docs/harness-work-essence.md"));
    }
    // ── Context budget audit (opt-in) ────────────────────────────
    // Stop hook attaches a session-end FAIL warning when the consumer opts in
    // via `harness.config.json.contextBudget.enabled === true`. The audit
    // itself is fail-open: any IO error during the audit becomes a SKIP signal
    // (which never elevates the verdict). The warning is purely observational —
    // `decision` stays `approve` so the user retains full control over the
    // next turn.
    const ctxBudget = outcome.config.contextBudget;
    if (ctxBudget && ctxBudget.enabled) {
        try {
            const audit = await runContextAudit({
                projectRoot,
                config: ctxBudget,
            });
            if (audit.verdict === "fail") {
                const failed = audit.signals
                    .filter((s) => s.status === "fail")
                    .map((s) => `${s.id}: ${s.detail}`)
                    .join(" | ");
                sections.push(sanitizeAdditionalContextLine(`[context budget] FAIL — ${failed}. Run: /context-audit (or /context-audit --strict for CI gating) — or move auto-load content into onDemandDirs (${ctxBudget.onDemandDirs.join(", ")})`));
            }
            else if (audit.verdict === "warn") {
                const warns = audit.signals
                    .filter((s) => s.status === "warn")
                    .map((s) => `${s.id}: ${s.detail}`)
                    .join(" | ");
                sections.push(sanitizeAdditionalContextLine(`[context budget] WARN — ${warns}`));
            }
        }
        catch (err) {
            // Strict fail-open: a bug in the audit engine must never break the Stop
            // hook. Surface the error on stderr only.
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[harness stop] context-audit error: ${msg}\n`);
        }
    }
    if (sections.length === 0) {
        return { decision: "approve" };
    }
    // Section separator is the literal two-character `\n` rather than a
    // raw LF, so that future dynamic content cannot smuggle fake section
    // boundaries through the additionalContext payload.
    return {
        decision: "approve",
        additionalContext: sections.join("\\n"),
    };
}
//# sourceMappingURL=stop.js.map