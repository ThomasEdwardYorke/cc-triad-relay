/**
 * core/src/config.ts
 * Harness configuration loader.
 *
 * Reads `harness.config.json` from the project root and merges with defaults.
 * Every guardrail that depends on project-specific values (R10/R11 etc.)
 * reads from the `HarnessConfig` on `RuleContext.config`.
 */
import { type ImageAspectRatio, type ImageGenerationConfig, type ImageReasoningEffort } from "./models/resolver.js";
export { type ImageAspectRatio, type ImageGenerationConfig, type ImageReasoningEffort, };
export type HarnessLanguage = "en" | "ja";
export type TamperingSeverity = "approve" | "ask" | "deny";
/**
 * Indicates whether the project consuming this harness config is a
 * downstream consumer (the common case: a project that installs harness as
 * a plugin and uses skills like `/harness-work`, `/coderabbit-review`) or
 * the harness plugin's **own** repository (the meta-session case: skills
 * the consumer uses don't apply, since the plugin itself ships them).
 *
 * Meta-session detection lets the plugin's own repository opt out of
 * consumer-only discipline gates without falsely logging a ledger
 * violation, since those gates fire skills that don't exist when the
 * plugin is being developed.
 */
export type RepoKind = "consumer" | "harness-itself";
/**
 * Tunables for the codex-sync agent aimed at mitigating mid-response
 * truncation caused by Claude Code's subagent output limit. See
 * `agents/codex-sync.md` for the user-facing remediation path.
 *
 * Background: Claude Code exposes `TASK_MAX_OUTPUT_LENGTH` (default
 * 32000 characters, runtime-observed cap at 160000) which middle-truncates
 * subagent final responses that exceed the effective limit (full output
 * is auto-saved to disk). codex-sync returns multi-KB Codex review output
 * and hit this truncation repeatedly during development. These knobs
 * let `harness doctor` warn when the effective limit is below the
 * runtime default without hardcoding the threshold inside bin/harness.
 */
export interface CodexSyncConfig {
    /**
     * Value `harness doctor` prints as the recommended setting for the
     * `TASK_MAX_OUTPUT_LENGTH` environment variable. Capped at 160000 —
     * Claude Code silently clamps higher values so advertising one would
     * be misleading.
     */
    recommendedTaskMaxOutputLength: number;
    /**
     * Threshold below which `harness doctor` flags the current effective
     * `TASK_MAX_OUTPUT_LENGTH` as WARN. Default 32000 mirrors Claude Code's
     * runtime default so the doctor warns whenever the env var is unset.
     */
    warnTaskMaxOutputLengthBelow: number;
    /**
     * When true, `harness doctor` reports the effective
     * `TASK_MAX_OUTPUT_LENGTH` alongside codex plugin detection. Set false
     * to silence the report entirely (e.g. for CI images where the env
     * var is intentionally left at the runtime default).
     */
    checkTaskMaxOutputLength: boolean;
}
export interface CodexConfig {
    /** Whether the codex-sync agent path resolution is active. */
    enabled: boolean;
    /**
     * Absolute path to the installed codex plugin root (e.g.
     * `${HOME}/.claude/plugins/cache/openai-codex/codex/1.0.2`).
     * If omitted, `harness doctor` auto-detects the latest version.
     */
    pluginRoot?: string;
    /**
     * Tunables for the codex-sync agent. **Non-optional after `loadConfig` /
     * `loadConfigSafe`**: `DEFAULT_CONFIG.codex.sync` is always populated and
     * `mergeConfig()` carries it through unconditionally (see the nested
     * spread in `mergeConfig` — `partial.codex?.sync ?? {}` fallback ensures
     * the merged object always has the three threshold fields).
     *
     * The user-facing JSON surface is still free to omit `codex.sync`
     * entirely; schema validation treats the section as optional. Only the
     * post-merge `HarnessConfig` consumer view is guaranteed to see a fully
     * populated `CodexSyncConfig`, which is why downstream code (bin/harness
     * doctor, `stop.ts` reminders, etc.) can dereference without optional
     * chaining.
     */
    sync: CodexSyncConfig;
}
export interface WorkModeConfig {
    /**
     * If true, R05 (`rm -rf` interactive confirmation) is bypassed when
     * harness is invoked in work mode. Intended for trusted agent workflows
     * that need non-interactive destructive cleanup (e.g. automated test
     * scratch directories). Leaves R10 (`protectedDirectories`) intact —
     * those directories are still refused.
     */
    bypassRmRf: boolean;
    /**
     * If true, the `git push --force` warning surfaced by R06 is downgraded
     * in work mode (the push itself is still executed, but the prompt is
     * skipped). Leaves main/master push protection rules elsewhere intact.
     */
    bypassGitPush: boolean;
}
export interface TamperingConfig {
    /** Decision returned when tampering patterns are detected. */
    severity: TamperingSeverity;
}
/**
 * Per-project override of harness quality gates consumed by `stop.ts` to
 * emit end-of-turn reminders. Each flag corresponds to a phase in
 * `/tdd-implement` and `/harness-work`.
 */
export interface QualityGatesConfig {
    /** Phase 2-3 TDD loop (Red → Green → Refactor). */
    enforceTddImplement: boolean;
    /** Phase 5.5 local Codex-based pseudo CodeRabbit pre-review. */
    enforcePseudoCoderabbit: boolean;
    /** Phase 6 real CodeRabbit PR review loop. */
    enforceRealCoderabbit: boolean;
    /** Phase 7 Codex adversarial second-opinion review. */
    enforceCodexSecondOpinion: boolean;
    /**
     * `harness-work-essence` discipline reminder. When true, the Stop hook
     * appends a generic "session essence" reminder summarising the 13-item
     * workflow contract documented in `docs/harness-work-essence.md`
     * (broad-scope task analysis, TDD + Codex parallel team, never-give-up
     * rule, end-of-session report + handoff archive/update). Default-off so
     * that projects already standardised on `/harness-work` see the
     * reminder only when they opt in.
     */
    enforceHarnessWorkEssence: boolean;
    /**
     * Project-relative path to a markdown file that records harness
     * discipline violations (e.g. when `/harness-merge-train` detects a
     * skill bypass and falls back to a manual workaround).
     *
     * When set, the ledger writer (`appendDisciplineEntry` in
     * `core/src/work/ledger.ts`) appends a single Markdown table row per
     * violation. When unset, the writer is a no-op so projects without an
     * opt-in ledger never see surprise file writes.
     *
     * Validation: project-relative paths only — absolute paths and `..`
     * segments are rejected by the writer so it cannot escape the project
     * root.
     */
    disciplineLedgerPath?: string;
}
/**
 * Task tracker source identifier consumed by `/harness-work` and related
 * skills. `"plans"` (default) reads the legacy flat `Plans.md` markdown
 * file. `"handoff"` opts the project into the 4-layer handoff structure
 * (`roadmap.md` / `backlog.md` / `current.md` / `decisions.md`) so the
 * skills can dispatch from the structured backlog while the roadmap layer
 * holds Phase / Week / AC source-of-truth.
 *
 * When set to `"handoff"`, `WorkConfig.handoffPaths` MUST be populated
 * with all four file paths. Missing or malformed entries cause
 * `validateWorkTaskTracker` to silently fall back to `"plans"` with a
 * stderr warning so consumers (skills, hooks) never see an undefined
 * dispatch source.
 */
export type TaskTrackerMode = "plans" | "handoff";
/**
 * 4-layer handoff document paths. All four fields are required when
 * `WorkConfig.taskTrackerMode === "handoff"`. Paths are project-relative
 * (anchored at `projectRoot`); absolute paths and `..` segments are
 * rejected by the loader to keep the handoff scope contained.
 *
 * Wholesale-replace semantics — the user-supplied object is used verbatim
 * (no merge with defaults) because partial overrides would yield silently
 * incomplete configs.
 */
export interface HandoffPathsConfig {
    /** Phase / Week / Task definition with YAML frontmatter (source-of-truth). */
    roadmap: string;
    /** Priority-ordered dispatchable view consumed by `/harness-work`. */
    backlog: string;
    /** Bird's-eye index file consumed by `/session-handoff check`. */
    current: string;
    /** Append-only design decisions log. */
    decisions: string;
}
export interface WorkConfig {
    /** Relative path to the project's task/plan file. Consumed by pre-compact and task-lifecycle hooks. */
    plansFile: string;
    /**
     * Task source for `/harness-work` and related skills. `"plans"` (default)
     * keeps the legacy `Plans.md` flow; `"handoff"` opts in to the 4-layer
     * handoff backlog. See `TaskTrackerMode` for the full contract.
     */
    taskTrackerMode: TaskTrackerMode;
    /**
     * 4-layer handoff document paths. Required when `taskTrackerMode ===
     * "handoff"`; ignored otherwise (but preserved for forward-compat so an
     * author can flip the mode later without re-typing the paths).
     */
    handoffPaths?: HandoffPathsConfig;
    /**
     * Section header keywords used to locate the assignment table inside the
     * plans file. Supports ja/en projects. First-match wins.
     */
    assignmentSectionMarkers: string[];
    /**
     * Project-specific session-handoff file paths that /harness-work and
     * /parallel-worktree update when closing a session. Existence-optional.
     */
    handoffFiles: string[];
    /**
     * Optional relative path to a project-local change log consumed by
     * /harness-plan sync. If unset, sync skips change-log scanning.
     */
    changeLogFile?: string;
    /**
     * Max concurrent tasks when `/harness-work` dispatches parallel execution
     * via `Task` tool (not via `/parallel-worktree`). Mirrors the `worktree`
     * family cap but is independently tunable so coordinators can keep a
     * lower in-process fan-out while still allowing wider multi-worktree
     * runs. 1-16.
     */
    maxParallel: number;
    /**
     * Label ordering used by `/harness-plan` / `/harness-work` when picking
     * the next task (first match wins). Empty array disables label-priority
     * ordering entirely and falls back to file order.
     */
    labelPriority: string[];
    /**
     * Labels that bypass the "minor" quick-path and force full quality
     * gates regardless of work-item size (e.g. `[security]`, `[data]`).
     */
    criticalLabels: string[];
    /**
     * Optional shell command that `/harness-work` runs as the canonical
     * test step. When unset, hooks fall back to per-stack auto-detection
     * (`detectAvailableChecks()` in `subagent-stop.ts`).
     */
    testCommand?: string;
    /**
     * Per-project override of harness quality gates. When a flag is false,
     * the corresponding phase is still allowed but its reminder is
     * suppressed in the Stop hook.
     */
    qualityGates: QualityGatesConfig;
    /**
     * When true, `/harness-work` aborts the batch on the first failing task
     * instead of running remaining tasks in isolation. Mirrors
     * `vitest --bail 1`-style semantics.
     */
    failFast: boolean;
    /**
     * Optional relative path to a project-local pipeline-verification runbook
     * (e.g. a `pipeline-check.md` reference under `.claude/skills/<project>-
     * local-rules/references/`). Consumed by `/harness-work` to surface the
     * project's pipeline-check guide as addendum when present; otherwise
     * `/harness-work` falls back to its stack-neutral built-in checks.
     *
     * Validation: project-relative paths only — absolute paths, `..`
     * segments, empty strings, and control-character payloads are rejected
     * by the loader (`validateWorkPipelineCheckPath`) so the path cannot
     * escape the project root or carry log-injection vectors. Rejected
     * values fall back to `undefined` after a stderr warning.
     */
    pipelineCheckPath?: string;
}
export interface SecurityConfig {
    /**
     * Relative path to a project-local security checklist. security-auditor
     * loads this file as addendum when present; otherwise runs the stack-neutral
     * generic checklist only.
     */
    projectChecklistPath?: string;
    /** Enabled security check categories. */
    enabledChecks: string[];
}
/**
 * Reviewer-side opt-in addendum surface. Mirrors `SecurityConfig`'s
 * `projectChecklistPath` but is consumed by `/harness-review` and the
 * generic `harness:reviewer` agent so the security and review surfaces
 * stay independently configurable. The plugin ships stack-neutral —
 * `projectChecklistPath` is undefined by default; consumers opt in by
 * pointing at a project-local runbook (e.g. a SKILL.md reference).
 *
 * Validation matches the family rule (see `validateReview` /
 * `validateWorkPipelineCheckPath`): project-relative paths only — empty
 * strings, absolute paths, `..` segments, and control-character
 * payloads are rejected with a stderr warning, after which the field
 * falls back to `undefined` so consumers cannot read a corrupted value.
 *
 * Containment caveat (lexical-only validation):
 *   The validator performs **lexical** path checks only and does NOT
 *   resolve symlinks. A relative path that passes validation but points
 *   to a symlink escaping the project root will still be accepted here.
 *   Caller agents (`/harness-review` / `harness:reviewer`) are
 *   responsible for runtime containment checks (e.g., `realpath` against
 *   project root) before invoking `Read`. This split keeps `loadConfig()`
 *   side-effect free and lets per-call agents apply policy as needed.
 */
export interface ReviewConfig {
    /**
     * Relative path to a project-local review runbook / addendum.
     * `/harness-review` and `harness:reviewer` agent load this file as
     * addendum when present; otherwise run the stack-neutral generic
     * runbook only.
     */
    projectChecklistPath?: string;
}
/**
 * Worktree orchestration mode. `true` / `false` force on/off; `"auto"`
 * delegates to `/harness-work` auto-detection (task-count based).
 */
export type WorktreeEnabledMode = boolean | "auto";
export interface WorktreeConfig {
    /** Whether /parallel-worktree and /harness-work may use git worktrees. */
    enabled: WorktreeEnabledMode;
    /** Max concurrent worktree sessions (1-16). */
    maxParallel: number;
    /** Parent directory (relative to `projectRoot`) where sibling worktrees are created. */
    parentDir: string;
    /** Optional prefix for generated worktree directory names (e.g. `myproj-wt-`). */
    prefix?: string;
    /** Optional base branch for new worktree branches (overrides `git symbolic-ref refs/remotes/origin/HEAD`). */
    defaultBaseBranch?: string;
}
/**
 * Pseudo-CodeRabbit review profile. `chill` / `assertive` match the
 * upstream CodeRabbit profiles verbatim; `strict` is a harness-local
 * extension that raises the nitpick surface.
 */
export type PseudoCoderabbitProfile = "chill" | "assertive" | "strict";
export interface TddEnforceConfig {
    /** If true, `/tdd-implement` refuses to proceed without a failing Red test. */
    alwaysRequireRedTest: boolean;
    /** If true, `[docs]`-labelled tasks may skip the Red-test requirement. */
    allowSkipOnDocsTasks: boolean;
    /** Pseudo CodeRabbit review profile. */
    pseudoCoderabbitProfile: PseudoCoderabbitProfile;
    /** Max Codex review loop iterations per Phase 5 round. */
    maxCodexReviewRetries: number;
}
/**
 * Identifier of the CodeRabbit subscription tier configured for this
 * project. Drives bucket-allocation guidance: `pro` keeps the legacy
 * single-bucket prediction (5 PR reviews / hour); `oss` opts into the
 * separate PR + CLI buckets the OSS plan provides; `free` is the
 * baseline (no automated review).
 *
 * Verified against CodeRabbit docs (2026-04-26 — see
 * https://docs.coderabbit.ai/): OSS plan exposes a CLI review bucket
 * independent of the PR review bucket, so projects on OSS can run
 * `coderabbit review` locally without consuming PR-bucket capacity.
 */
export type CodeRabbitPlan = "free" | "oss" | "pro";
export interface CodeRabbitConfig {
    /** GitHub login of the CodeRabbit bot (for comment authorship checks). */
    botLogin: string;
    /**
     * Minutes to look back when deciding whether a `rate-limited` / `Reviews
     * paused` marker is still active. Defaults to 15 per CodeRabbit Pro
     * cooldown semantics.
     */
    ratelimitCheckWindowMinutes: number;
    /** If true, PR review state = "APPROVED" is treated as an immediate clear signal. */
    approvedStateAsClear: boolean;
    /** Max pseudo-CodeRabbit loop iterations before escalating to real CodeRabbit. */
    maxPseudoLoopIterations: number;
    /** CodeRabbit Pro "5 reviews / 1 hour" bucket size (used for local rate prediction). */
    proBucketSize: number;
    /** Window (in minutes) for the CodeRabbit Pro review bucket. */
    proBucketWindowMinutes: number;
    /**
     * Subscription tier driving bucket allocation. `pro` (default) keeps
     * the legacy single-bucket model; `oss` enables the dual PR + CLI
     * buckets the OSS plan exposes; `free` documents that the project
     * has no automated CodeRabbit review.
     */
    plan: CodeRabbitPlan;
    /**
     * PR review bucket size per `proBucketWindowMinutes` window.
     *
     * Default `5` matches Pro. When `plan` flips to `oss`, the consumer
     * **must explicitly** set this to `2` (CodeRabbit's published OSS
     * quota) — `mergeConfig` does not auto-derive a per-plan value, so
     * leaving the field at its default while only changing `plan` is a
     * configuration bug, not a feature. Use this field for new code
     * paths; `proBucketSize` is preserved for backwards compatibility.
     */
    prReviewBucketSize: number;
    /**
     * CLI review bucket size per `proBucketWindowMinutes` window.
     *
     * Default `0` documents that the CLI path is unavailable for the
     * current plan (Pro / Free). OSS exposes `2/h` independent of the
     * PR bucket — set this to `2` explicitly when flipping `plan` to
     * `oss`. As with `prReviewBucketSize`, no automatic fallback is
     * applied.
     */
    cliReviewBucketSize: number;
}
/**
 * Stack-detection knobs. Kept separate from `work.*` because these answer
 * "where does this project keep its source?" questions rather than "how
 * should `/harness-work` schedule tasks?" questions.
 */
export interface ToolingConfig {
    /**
     * Directory names that `subagent-stop.ts`'s `detectAvailableChecks()`
     * consults when choosing Python lint / typecheck targets. Only existing
     * directories are included. Default `["src", "app"]` — stack-neutral;
     * projects with a `backend/` layout add it explicitly via override.
     */
    pythonCandidateDirs: string[];
}
/**
 * Branch-merge strategy identifier consumed by `/branch-merge` and
 * `/harness-release`. `three-branch` is the default (feature/* → dev →
 * main); `two-branch` skips dev entirely for trunk-style repos.
 */
export type ReleaseStrategy = "two-branch" | "three-branch";
/**
 * PostToolUseFailure hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): this hook fires
 * when tool execution fails (exception / non-zero exit / interrupt) on a
 * path separate from `PostToolUse`. Non-blocking observability hook that
 * adds failure diagnostics and optional corrective hints to
 * `additionalContext` so Claude has material for next-turn recovery.
 *
 * When `correctiveHints` is true (default), the harness built-in hint
 * matchers cover common error patterns (permission denied / no such file /
 * command not found / signal abort / timeout / network unreachable) and
 * append a short suggestion string.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open).
 */
export interface PostToolUseFailureConfig {
    /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
    enabled: boolean;
    /**
     * Maximum length of the raw error string before truncation. Excess is
     * cut with an inline marker. Range: 256-16384 chars, default 1024.
     */
    maxErrorLength: number;
    /**
     * When true (default), append a corrective hint for the first matching
     * built-in error pattern. Set false to inject the raw error only
     * (no hint lookup).
     */
    correctiveHints: boolean;
}
/**
 * Context budget audit configuration.
 *
 * Optional, opt-in subsystem that watches how much auto-loaded
 * `.claude/rules/` (or any consumer-configured directory) content is
 * shipped into the Claude Code context budget on every session start.
 *
 * - **Audit**: a 3-gate check (size budget, dead-link reachability, committed
 *   entry-point reachability) implemented in `core/src/context-audit/`.
 * - **Stop hook integration**: when `enabled: true`, the Stop hook injects
 *   a FAIL marker into `additionalContext` so the next session start surfaces
 *   re-bloat early.
 * - **PreToolUse integration**: when a Write tool targets a file under
 *   `autoLoadDirs`, the PreToolUse hook predicts whether the write would
 *   exceed `budgetBytes`. Excess prediction triggers a soft suggestion to
 *   re-route the content into `onDemandDirs` instead — never blocks.
 *
 * When `enabled: false` (default), every integration point is a no-op so
 * existing projects opting out incur zero behavioural cost.
 */
export interface ContextBudgetConfig {
    /**
     * Master switch. Default `false` (opt-in). When false, Stop / PreToolUse
     * integration points become no-ops and the historical baseline is preserved.
     */
    enabled: boolean;
    /**
     * Auto-load total byte budget. Default `35000` matches the test-bed
     * precedent recorded in the model-b design-decisions ledger
     * (`docs/maintainer/`).
     * Range: 1024 - 524288.
     */
    budgetBytes: number;
    /**
     * Directories whose `.md` content gets prefix auto-loaded by Claude Code
     * on session start. Sizes are summed against `budgetBytes`. Default
     * `[".claude/rules"]`. Path-traversal entries (`..` or absolute) are
     * rejected at audit time.
     */
    autoLoadDirs: string[];
    /**
     * Directories where on-demand rules can be re-housed when the auto-load
     * budget is exceeded. Used in the redirect suggestion that the PreToolUse
     * hook surfaces. Default `["docs/ai-rules"]`.
     */
    onDemandDirs: string[];
    /**
     * Committed entry-point files (root-level docs Claude is guaranteed to see).
     * Must reference at least one entry in `onDemandDirs` for the entry-point
     * gate to PASS. Default `["CLAUDE.md", "README.md"]`.
     */
    entryPointFiles: string[];
    /**
     * Optional index file path (relative to project root). When non-empty,
     * the audit verifies the file exists. Default `""` (check disabled).
     */
    indexFile: string;
}
/**
 * ConfigChange hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): fires when a
 * configuration file changes during a session (external editor / process
 * modifies `settings.json` / `settings.local.json` / skills files). The
 * matcher filters by source — `user_settings` / `project_settings` /
 * `local_settings` / `policy_settings` / `skills`.
 *
 * Observability-first hook with opt-in blocking: default behaviour is
 * `decision: "approve"` with a diagnostic context. Users set
 * `blockOnSources: ["policy_settings"]` (etc.) to enforce immutability
 * for specific sources, without writing a bespoke hook.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open, matching the rest of the harness hook stack).
 */
export interface ConfigChangeConfig {
    /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
    enabled: boolean;
    /**
     * Max file_path display length before truncation. Excess is cut with an
     * inline marker containing the per-request nonce so spoofing is hard.
     * Range: 32-4096 chars, default 256.
     */
    maxFilePathLength: number;
    /**
     * When true (default), emit `hint: potential secret file` for
     * `.env` / `.env.<suffix>` / `secrets.<ext>` / `credentials.<ext>` /
     * `*.pem` / `*.key` / `*.p12` / `*.pfx`. Hint is observational only —
     * the handler never blocks based on sensitive-path detection.
     */
    detectSensitivePaths: boolean;
    /**
     * Matcher sources that cause this hook to return `decision: "block"`
     * and reject the configuration change. Only valid enum values are
     * honoured (`user_settings` / `project_settings` / `local_settings` /
     * `policy_settings` / `skills`); unknown entries are silently dropped
     * so a malformed config cannot turn the hook into a blunt
     * reject-everything instrument.
     *
     * Default `[]` (observability only — never blocks).
     */
    blockOnSources: string[];
}
/**
 * UserPromptSubmit hook configuration.
 *
 * Designed as the harness "Global plugin → Local project rules bridge":
 * each user prompt is augmented with project-local context (e.g.
 * `.claude/rules/coding-style.md`) so Claude inherits invariants the
 * project owner cares about, without forcing the user to re-paste them.
 *
 * Empty `contextFiles` (default) makes the hook a no-op — handler returns
 * `decision: "approve"` with no `additionalContext`, matching fail-open
 * behaviour throughout the harness.
 */
export interface UserPromptSubmitConfig {
    /**
     * Project-local context file paths (relative to `projectRoot`) appended
     * to each user prompt as `hookSpecificOutput.additionalContext`.
     * Missing files are skipped silently. Path-traversal entries (`..` or
     * absolute paths) are rejected and skipped.
     */
    contextFiles: string[];
    /**
     * Total byte cap across all contextFiles. Excess content is truncated
     * with an inline marker so Claude can detect the boundary. Range 256
     * (minimal) to 65536 (64 KiB) to keep prompt overhead bounded.
     */
    maxTotalBytes: number;
    /**
     * When true, the injected context block is wrapped in fence markers with
     * a per-request nonce (12 hex chars, 48-bit entropy):
     * `===== HARNESS PROJECT-LOCAL CONTEXT <nonce> =====` /
     * `===== END HARNESS CONTEXT <nonce> =====`
     * so the user / reader can attribute the content to the harness rather
     * than mistaking it for their own prompt. The nonce prevents context
     * boundary spoofing by literal fence markers embedded in rule file
     * content (attackers cannot predict the per-request value).
     */
    fenceContext: boolean;
}
/**
 * SubagentStart hook configuration.
 *
 * Official spec (https://code.claude.com/docs/en/hooks): fires when the
 * Task tool spawns a subagent, **before** the subagent runs. The handler
 * emits `hookSpecificOutput.additionalContext` which is injected into
 * the **subagent's** context (unidirectional). Analogous to
 * UserPromptSubmit for the top-level prompt, but scoped to subagents.
 *
 * SubagentStart is informational-only — the official spec does **not**
 * support `decision: "block"` (blocking belongs to the earlier
 * PreToolUse hook on the Task tool call). The harness handler therefore
 * always returns `"approve"`.
 *
 * Observability + opt-in per-type guidance: use `agentTypeNotes` to
 * inject short reminders (e.g. `{ "harness:worker": "TDD first" }`)
 * into the corresponding subagent's context.
 *
 * When `enabled` is false or the config is malformed, the handler
 * silently returns `decision: "approve"` with no `additionalContext`
 * (fail-open, matching the rest of the harness hook stack).
 */
export interface SubagentStartConfig {
    /** Global on/off switch. When false the handler returns `approve` with no `additionalContext`. */
    enabled: boolean;
    /**
     * Max character length for `agent_type` / `agent_id` display before
     * truncation. Excess is cut with an inline marker containing the
     * per-request nonce so spoofing is hard. Range 32-1024, default 128.
     */
    maxIdentifierLength: number;
    /**
     * When true (default), wrap the diagnostic in fence markers with a
     * per-request nonce (12 hex chars, 48-bit entropy):
     * `===== HARNESS SubagentStart <nonce> =====` /
     * `===== END HARNESS SubagentStart <nonce> =====`.
     * The nonce defeats context-boundary spoofing by literal fence
     * markers embedded in `agentTypeNotes` values.
     */
    fenceContext: boolean;
    /**
     * Per-agent-type guidance notes injected into the subagent context
     * as additional lines inside the fence. Key matches `agent_type`
     * verbatim (undefined input coalesces to `"unknown"` — use the
     * key `"unknown"` to target it). Missing keys / non-string values
     * are silently dropped.
     *
     * Default `{}` (no notes — diagnostic header only).
     */
    agentTypeNotes: Record<string, string>;
    /**
     * Total byte cap for the emitted `additionalContext`. Excess is
     * truncated with an inline marker so the subagent can detect the
     * boundary. Range 256-65536, default 4096 (keeps subagent prompt
     * overhead bounded).
     */
    maxTotalBytes: number;
}
export interface ReleaseConfig {
    /** Branch-merge strategy. Controls how /branch-merge walks feature → integration → production. */
    strategy: ReleaseStrategy;
    /**
     * Intermediate branch name used when `strategy === "three-branch"`.
     * Ignored otherwise. Default `"dev"`.
     */
    integrationBranch: string;
    /**
     * Final / production branch name. Default `"main"`. Tags from
     * `/harness-release` land here.
     */
    productionBranch: string;
    /**
     * Command executed before each merge step. When unset, /harness-release
     * falls back to `work.testCommand` and then to per-stack autodetection.
     */
    testCommand?: string;
}
/**
 * Model registry configuration. Controls which Codex model every
 * harness-dispatched Codex invocation targets, with a per-agent override
 * surface and a logical-alias table so projects can pin a specific Codex
 * model (including a legacy model for reproducibility) without editing
 * the agent markdown.
 *
 * Implementation lives in `src/models/resolver.ts`; consumers are the
 * `bin/harness model resolve` CLI, each Codex-dispatching agent's
 * Invocation Rules, and the `harness model check` deprecation linter.
 * See `HARNESS_DEFAULT_MODEL` in resolver.ts for the compile-time default.
 */
export interface ModelsCodexRegistryConfig {
    default?: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    aliases?: Record<string, string>;
}
export interface ModelsAgentRegistryConfig {
    model?: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}
export interface ModelsConfig {
    codex?: ModelsCodexRegistryConfig;
    agents?: Record<string, ModelsAgentRegistryConfig>;
}
export interface HarnessConfig {
    /** Human-readable project name (shown in messages). */
    projectName: string;
    /** Language used for messages when a localized form is available. */
    language: HarnessLanguage;
    /**
     * Whether this project is a consumer of the harness plugin or the
     * plugin's own repository. Defaults to `"consumer"`. Set to
     * `"harness-itself"` in the plugin repo to suppress consumer-only
     * discipline-gate skill invocations which would otherwise log spurious
     * ledger violations.
     */
    repoKind: RepoKind;
    /**
     * Directory names that R10 refuses to delete via `rm`/`rmdir`/`unlink`.
     * Empty array disables R10 entirely (default).
     */
    protectedDirectories: string[];
    /**
     * Environment-variable names that R11 blocks from appearing in Bash
     * commands. Empty array disables R11 entirely.
     */
    protectedEnvVarNames: string[];
    /**
     * File suffixes whose direct access (cat/head/tail/…) is blocked by R13.
     * Defaults to [".env"].
     */
    protectedFileSuffixes: string[];
    codex: CodexConfig;
    workMode: WorkModeConfig;
    tampering: TamperingConfig;
    work: WorkConfig;
    security: SecurityConfig;
    review: ReviewConfig;
    worktree: WorktreeConfig;
    tddEnforce: TddEnforceConfig;
    codeRabbit: CodeRabbitConfig;
    tooling: ToolingConfig;
    release: ReleaseConfig;
    userPromptSubmit: UserPromptSubmitConfig;
    postToolUseFailure: PostToolUseFailureConfig;
    configChange: ConfigChangeConfig;
    /**
     * Per-project infrastructure manifest injected into worker prompts so
     * subagents can detect infra-driven failure (e.g. local DB version differs
     * from CI) without exploring forbidden workarounds. Optional, free-form
     * object; coordinator (parallel-worktree / harness-work / tdd-implement)
     * materializes this into a markdown bullet list and prepends it to the
     * worker prompt. When undefined, coordinator emits an empty manifest
     * section. See `commands/parallel-worktree.md` "Environment Manifest
     * injection" for the materialization algorithm and recommended sub-keys
     * (`postgres` / `node` / `ci_environment` / `forbidden_workarounds`).
     */
    environmentManifest?: Record<string, unknown>;
    subagentStart: SubagentStartConfig;
    /**
     * Optional context-budget audit knobs. Always populated post-merge —
     * `DEFAULT_CONFIG.contextBudget` ships with `enabled: false` so consumers
     * incur zero behavioural cost until they opt in.
     */
    contextBudget: ContextBudgetConfig;
    /**
     * Image-generation skill registry. Always populated post-merge —
     * `DEFAULT_CONFIG.imageGeneration` ships full defaults so callers do
     * not need optional chaining. The user-facing JSON surface still
     * accepts partial overrides (sibling keys keep their defaults).
     */
    imageGeneration: ImageGenerationConfig;
    /**
     * Optional model registry. When absent, harness resolves to
     * `HARNESS_DEFAULT_MODEL` (see `src/models/resolver.ts`).
     */
    models?: ModelsConfig;
}
export declare const DEFAULT_CONFIG: HarnessConfig;
/**
 * Load harness config from `<projectRoot>/harness.config.json`.
 * Returns defaults if the file does not exist.
 * Throws if the file exists but is not valid JSON **or** if the parsed
 * value is not a JSON object (e.g. `42`, `[]`, `null`) — callers should
 * be prepared to fall back to defaults via a try/catch if they prefer
 * fail-open behaviour.
 */
export declare function loadConfig(projectRoot: string): HarnessConfig;
/**
 * Fail-open variant: returns defaults when the file is missing, unreadable,
 * or malformed. Used by the guardrail hook path where any error in config
 * loading must not break tool execution.
 *
 * This variant **silently** swallows errors. Hooks that need to
 * distinguish "config absent" from "config broken" (so they can emit a
 * diagnostic rather than silently applying defaults) should use
 * `loadConfigWithError()` instead.
 */
export declare function loadConfigSafe(projectRoot: string): HarnessConfig;
/**
 * Outcome of a config load attempt that surfaces the error for the
 * caller to decide what to do. Hooks that care whether the config file
 * parsed successfully (so they can warn / suppress unreliable behaviour)
 * use this instead of `loadConfigSafe()`.
 *
 * Invariant: `config` is always a valid `HarnessConfig`. When `error`
 * is set, `config` is `DEFAULT_CONFIG` (the same value `loadConfigSafe`
 * would return) — callers can still proceed, but now they know that
 * they fell back because of a parse failure, not because the user
 * deliberately accepted defaults.
 */
export interface ConfigLoadOutcome {
    /** Parsed config on success, DEFAULT_CONFIG when `error` is set. */
    config: HarnessConfig;
    /**
     * Populated when `loadConfig()` threw (malformed JSON / shape error /
     * I/O failure). Not populated when the file is simply absent — absence
     * is a valid opt-in-to-defaults state, not an error.
     */
    error?: string;
}
/**
 * Load harness config and surface any parse error to the caller.
 *
 * - File absent ⇒ `{ config: DEFAULT_CONFIG }` (no error).
 * - File present and parses OK ⇒ `{ config: <merged> }` (no error).
 * - File present but parse / shape error ⇒ `{ config: DEFAULT_CONFIG, error }`.
 *
 * The implementation is the same as `loadConfigSafe()` plus the error
 * surfacing. Hooks that previously suppressed the error and quietly ran
 * with defaults (e.g. `stop.ts` emitting every quality-gate reminder
 * because `mergeConfig` filled in `qualityGates=true` defaults) should
 * use this to **refuse** to act on defaults when a broken config
 * explicitly fell through.
 */
export declare function loadConfigWithError(projectRoot: string): ConfigLoadOutcome;
//# sourceMappingURL=config.d.ts.map