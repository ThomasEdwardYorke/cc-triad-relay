/**
 * core/src/guardrails/pre-tool.ts
 * PreToolUse hook evaluator.
 *
 * Builds a RuleContext from the hook input, loaded harness config, and any
 * per-session work-state flags, then delegates to rules.ts. Wraps the
 * resulting `HookResult` with an opt-in context-budget redirect suggestion
 * when the Write target lives under any configured `autoLoadDirs/`.
 */

import { existsSync } from "node:fs";
import { loadConfigSafe } from "../config.js";
import { HarnessStore } from "../state/store.js";
import { defaultStatePath } from "../state/migration.js";
import { predictBudgetImpact } from "../context-audit/index.js";
import { evaluateRules } from "./rules.js";
import type { HookInput, HookResult, RuleContext } from "../types.js";

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function resolveStatePath(projectRoot: string): string | null {
  const path = defaultStatePath(projectRoot);
  return existsSync(path) ? path : null;
}

/** Resolve the project root from hook input or environment. */
function resolveProjectRoot(input: HookInput): string {
  return (
    input.cwd ??
    process.env["HARNESS_PROJECT_ROOT"] ??
    process.env["PROJECT_ROOT"] ??
    process.cwd()
  );
}

function buildContext(input: HookInput): RuleContext {
  const projectRoot = resolveProjectRoot(input);
  const config = loadConfigSafe(projectRoot);

  let workMode =
    isTruthy(process.env["HARNESS_WORK_MODE"]) ||
    isTruthy(process.env["ULTRAWORK_MODE"]);
  let codexMode = isTruthy(process.env["HARNESS_CODEX_MODE"]);
  const breezingRole = process.env["HARNESS_BREEZING_ROLE"] ?? null;

  // Augment from work_state store if a session id and state file exist.
  const sessionId = input.session_id;
  if (sessionId !== undefined && sessionId !== "") {
    const statePath = resolveStatePath(projectRoot);
    if (statePath !== null) {
      try {
        const store = new HarnessStore(statePath);
        try {
          const state = store.getWorkState(sessionId);
          if (state !== null) {
            workMode = workMode || state.bypassRmRf || state.bypassGitPush;
            codexMode = codexMode || state.codexMode;
          }
        } finally {
          store.close();
        }
      } catch {
        // Fail open — config alone is enough to evaluate rules.
      }
    }
  }

  // Apply config.workMode defaults (can upgrade but not downgrade explicit env flags).
  if (config.workMode.bypassRmRf || config.workMode.bypassGitPush) {
    workMode = true;
  }

  return {
    input,
    projectRoot,
    workMode,
    codexMode,
    breezingRole,
    config,
  };
}

export async function evaluatePreTool(input: HookInput): Promise<HookResult> {
  const ctx = buildContext(input);
  const ruleResult = evaluateRules(ctx);

  // Existing deny / ask paths are passed through untouched so we do not
  // accidentally upgrade a hard deny to an approve. The context-budget
  // augmentation only meaningfully applies to approves.
  if (ruleResult.decision === "deny" || ruleResult.decision === "ask") {
    return ruleResult;
  }

  return augmentWithContextAudit(ruleResult, ctx, input);
}

/**
 * Wrap an `approve` result with a context-budget redirect suggestion when
 * the Write target lives under any `autoLoadDirs` and the predicted post-
 * write total exceeds `budgetBytes`. Strictly observational — the decision
 * remains `approve` so the user retains full control.
 *
 * Backward compat:
 *   - `contextBudget.enabled === false` (default) → no-op
 *   - tool_name !== "Write" → no-op
 *   - filePath outside `autoLoadDirs` → no-op
 *   - newContent shrinks the file → no-op (refactors-down are always fine)
 */
async function augmentWithContextAudit(
  prev: HookResult,
  ctx: RuleContext,
  input: HookInput,
): Promise<HookResult> {
  const cfg = ctx.config.contextBudget;
  if (!cfg.enabled) return prev;
  if (input.tool_name !== "Write") return prev;

  const filePath = extractStringField(input.tool_input, "file_path");
  const content = extractStringField(input.tool_input, "content");
  if (filePath === undefined || content === undefined) return prev;

  let prediction: Awaited<ReturnType<typeof predictBudgetImpact>>;
  try {
    prediction = await predictBudgetImpact({
      projectRoot: ctx.projectRoot,
      config: cfg,
      filePath,
      newContent: content,
    });
  } catch (err) {
    // Fail-open: a bug in the audit engine must never break PreToolUse.
    process.stderr.write(
      `[harness pre-tool] context-audit error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return prev;
  }
  if (!prediction.targetIsAutoLoad) return prev;
  if (!prediction.wouldExceed) return prev;

  const overBy = Math.max(0, prediction.predictedTotalBytes - prediction.budgetBytes);
  const ondemandHint =
    cfg.onDemandDirs.length > 0
      ? cfg.onDemandDirs.join(", ")
      : "(no onDemandDirs configured — set harness.config.json.contextBudget.onDemandDirs)";
  const note = `[context budget] auto-load redirect suggested — writing ${filePath} would push total to ${prediction.predictedTotalBytes} bytes (${overBy} over budget ${prediction.budgetBytes}). Consider relocating to onDemandDirs (${ondemandHint}) and adding a CLAUDE.md / README.md cross-reference instead.`;

  // Compose with any pre-existing additionalContext from rules.ts so we
  // never overwrite a guardrail message. The two-character separator is
  // a literal `\\n` (matches the Stop hook convention).
  const merged =
    prev.additionalContext !== undefined && prev.additionalContext.length > 0
      ? `${prev.additionalContext}\\n${note}`
      : note;
  return {
    ...prev,
    decision: prev.decision,
    additionalContext: merged,
  };
}

function extractStringField(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}
