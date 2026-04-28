/**
 * core/src/guardrails/pre-tool.ts
 * PreToolUse hook evaluator.
 *
 * Builds a RuleContext from the hook input, loaded harness config, and any
 * per-session work-state flags, then delegates to rules.ts. Wraps the
 * resulting `HookResult` with an opt-in context-budget redirect suggestion
 * when the Write target lives under any configured `autoLoadDirs/`.
 */
import type { HookInput, HookResult } from "../types.js";
export declare function evaluatePreTool(input: HookInput): Promise<HookResult>;
//# sourceMappingURL=pre-tool.d.ts.map