/**
 * core/src/work/parallel-mode-resolver.ts
 *
 * Pure-function resolver that decides whether `/harness-work` should
 * delegate parallel work to **Model A** (`/parallel-worktree` v1) or
 * **Model B** (`/parallel-worktree-v2`) for a single dispatch.
 *
 * Mirrors `profile-resolver.ts`:
 *   - All inputs are passed in (no env / fs reads inside the resolver).
 *   - Invalid values fall through with a warning instead of throwing, so
 *     the caller can keep going with the default mode and surface the
 *     warning to the user.
 *
 * Precedence chain (highest first):
 *   1. cliFlag                    — `--parallel-mode=v1|v2` from the skill caller
 *   2. auto-rule failure-history  — `nTasks >= 2 && recentSubagentFailures >= 2`
 *                                   (gated on `allowAutoModelB`)
 *   3. auto-rule task-count       — `nTasks >= 3`
 *                                   (gated on `allowAutoModelB`)
 *   4. harnessConfigDefault       — `harness.config.json.work.parallelMode`
 *   5. default                    — `v1` (back-compat)
 *
 * `allowAutoModelB` defaults to `false` so existing consumers see no
 * behaviour change until they explicitly opt in. Once opt-in, the
 * resolver picks Model B when EITHER auto rule fires.
 *
 * Spec source: `commands/harness-work.md` v6 Auto Mode Detection section.
 */

/**
 * Allowed values for `--parallel-mode` and `work.parallelMode`.
 *
 * Kept as a literal tuple in the resolver (not imported from `config.ts`)
 * to keep this file pure-function — the resolver is consumed by both
 * `loadConfig`-aware callers and direct CLI argv parsers, so depending
 * on `config.ts` would create a cycle.
 */
export const VALID_PARALLEL_MODES = ["v1", "v2"] as const;

export type ParallelMode = (typeof VALID_PARALLEL_MODES)[number];

/** Source from which the resolved mode was taken (telemetry / user-facing). */
export type ParallelModeSource =
  | "cli"
  | "auto-failure-history"
  | "auto-task-count"
  | "harness-config"
  | "default";

export interface ParallelModeResolverInput {
  /**
   * `--parallel-mode=<value>` flag value (highest precedence).
   * Undefined / empty / whitespace-only → ignored.
   * Invalid (anything other than `v1` / `v2`) → warning + fall through.
   */
  cliFlag?: string;
  /** Number of tasks the dispatcher is about to fan out. Defaults to 0. */
  nTasks?: number;
  /**
   * Recent (~30d window) subagent failure count from the discipline ledger
   * (`work.qualityGates.disciplineLedgerPath`). Defaults to 0 — when the
   * caller cannot read the ledger, treat as zero failures so the
   * failure-history rule does not over-fire on a missing input.
   */
  recentSubagentFailures?: number;
  /**
   * Project-side opt-in for auto Model B downgrade. Mirrors
   * `harness.config.json.work.allowAutoModelB`. Defaults to `false` — both
   * auto rules are disabled until explicitly enabled.
   */
  allowAutoModelB?: boolean;
  /**
   * `harness.config.json.work.parallelMode` (project-side default).
   * When unset / undefined the chain falls through to the built-in
   * default (`v1`). Typed as `string | undefined` (defensive against
   * untyped callers — a malformed value emits a warning and falls
   * through, mirroring `cliFlag` validation).
   */
  harnessConfigDefault?: string;
}

export interface ParallelModeResolution {
  mode: ParallelMode;
  source: ParallelModeSource;
  warnings: string[];
}

function isValidMode(value: string): value is ParallelMode {
  return (VALID_PARALLEL_MODES as readonly string[]).includes(value);
}

/**
 * Defensive coercion for inputs that may arrive from untyped callers
 * (e.g. raw argv parsers, JSON config loaders). Non-string truthy
 * values like `42` or `false` would crash `(input ?? "").trim()` if we
 * only used the nullish coalescing operator. Strings are returned
 * verbatim; everything else is treated as absent (empty string), so
 * the resolver's regular fallthrough path applies without throwing.
 */
function coerceOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Resolve the effective parallel-mode by walking the precedence chain.
 * Pure function — no env / fs reads.
 */
export function resolveParallelMode(
  input: ParallelModeResolverInput,
): ParallelModeResolution {
  const warnings: string[] = [];

  // 1. cliFlag (highest)
  const cliRaw = coerceOptionalString(input.cliFlag).trim();
  if (cliRaw.length > 0) {
    if (isValidMode(cliRaw)) {
      return { mode: cliRaw, source: "cli", warnings };
    }
    warnings.push(
      `--parallel-mode='${cliRaw}' is invalid (must be one of ${VALID_PARALLEL_MODES.join("/")}); falling through.`,
    );
  }

  // 2. & 3. auto rules (gated on opt-in)
  const allowAutoModelB = input.allowAutoModelB ?? false;
  if (allowAutoModelB) {
    const nTasks = input.nTasks ?? 0;
    const failures = input.recentSubagentFailures ?? 0;
    // Failure-history rule fires first so the resolver can attribute the
    // downgrade to "WHY" (recent failures) rather than just "how many tasks".
    if (nTasks >= 2 && failures >= 2) {
      return { mode: "v2", source: "auto-failure-history", warnings };
    }
    if (nTasks >= 3) {
      return { mode: "v2", source: "auto-task-count", warnings };
    }
  }

  // 4. harness config default — defensive validation against untyped JSON.
  // The config loader normally keeps this on the allowlist, but the resolver
  // re-checks so a malformed payload (`{"work":{"parallelMode":"v3"}}`)
  // cannot leak an invalid mode to the dispatcher.
  const cfgRaw = coerceOptionalString(input.harnessConfigDefault).trim();
  if (cfgRaw.length > 0) {
    if (isValidMode(cfgRaw)) {
      return { mode: cfgRaw, source: "harness-config", warnings };
    }
    warnings.push(
      `harness.config.json work.parallelMode='${cfgRaw}' is invalid (must be one of ${VALID_PARALLEL_MODES.join("/")}); falling through to default.`,
    );
  }

  // 5. default — v1 keeps back-compat with v5 dispatcher behaviour.
  return { mode: "v1", source: "default", warnings };
}
