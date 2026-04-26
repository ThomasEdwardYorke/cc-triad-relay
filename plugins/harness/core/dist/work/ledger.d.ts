/**
 * core/src/work/ledger.ts
 *
 * Consumer-side discipline ledger writer. Records harness skill-bypass
 * violations detected by `/harness-merge-train` (and any other skill
 * that opts into the same machinery) into a project-local Markdown
 * file.
 *
 * Why this exists:
 * - The harness rules document (consumer-side
 *   `<project>/.claude/rules/implementation-workflow.md`) declares a
 *   strict "all gates must be invoked via skills" contract. When a
 *   skill cannot run (rate limited, environment issue) and the harness
 *   falls back to a manual workaround, that fallback is logged so the
 *   trust boundary stays auditable.
 * - The path is opted in per project via
 *   `harness.config.json → work.qualityGates.disciplineLedgerPath`.
 *   Projects without a path see no file writes.
 *
 * Atomicity:
 * - Each append is a single `fs.appendFileSync` call. The kernel
 *   `write(2)` syscall under `O_APPEND` is POSIX-atomic for payloads
 *   below `PIPE_BUF` (4096 B on macOS / Linux); entries are short
 *   single-row markdown rows so the bound holds easily. That is the
 *   guarantee on which **cross-process** safety rests — the writer is
 *   safe even when several Node.js processes append to the same
 *   ledger concurrently, as long as the underlying filesystem honours
 *   the POSIX guarantee (local disks do; network filesystems may not).
 * - **Within a single Node.js process** the synchronous fs API is
 *   serialised by the event loop, so interleaving cannot occur there
 *   either. The in-process 50-parallel test in `ledger.test.ts`
 *   verifies that serialisation; it does not (and cannot, with
 *   `appendFileSync`) re-prove the cross-process invariant. Replicate
 *   that path with `child_process.fork` if a regression suite ever
 *   needs to assert it directly.
 * - Initial creation uses `writeFileSync` with `flag: "wx"` so two
 *   racing creators cannot both write the header. The loser falls back
 *   to a regular append after the file appears.
 *
 * Sandbox:
 * - The path must be project-relative. Absolute paths and any `..`
 *   segment are rejected before any filesystem touch happens. The
 *   fully resolved path is double-checked to live under `projectRoot`
 *   so symlink-free dot games cannot escape the sandbox either.
 */
import type { HarnessConfig } from "../config.js";
/**
 * One row in the discipline ledger. All fields are free-form strings;
 * `formatEntry` escapes pipe + newline characters before emitting the
 * markdown row so callers can pass any unicode without breaking the
 * table grammar.
 */
export interface DisciplineEntry {
    /**
     * ISO-8601 date or full timestamp identifying when the violation
     * occurred (the writer does not synthesise this — callers stamp it
     * so manual + skill-driven entries share an authoritative clock).
     */
    date: string;
    /**
     * Identifier of the session that produced the violation. Free-form
     * so consumers can use commit hashes, branch slugs, or operator
     * names without forcing a single canonical format.
     */
    session: string;
    /**
     * Identifier of the skill / gate that was bypassed (e.g. `G2`,
     * `G7`, `/codex-team`).
     */
    skillId: string;
    /** One-sentence summary of what went wrong as a result. */
    impact: string;
    /** One-sentence remediation note (how to fix or what to do next). */
    remediation: string;
}
export interface AppendDisciplineSuccess {
    status: "appended";
    /** Absolute path to the ledger file the entry was written to. */
    ledgerPath: string;
}
export interface AppendDisciplineNoOp {
    status: "no-op-no-config";
    /** Why the writer chose to do nothing (for log surfaces). */
    reason: string;
}
export type AppendDisciplineResult = AppendDisciplineSuccess | AppendDisciplineNoOp;
/**
 * Append one discipline-violation row to the configured ledger.
 *
 * @param config        Loaded `HarnessConfig` (post-merge with defaults).
 * @param projectRoot   Absolute path to the consumer project root.
 * @param entry         Row data — all fields are escaped automatically.
 * @returns             `appended` with the resolved path, or
 *                      `no-op-no-config` when the ledger is opt-out.
 * @throws  When the configured path is absolute, escapes the project
 *          root, or `projectRoot` itself is not an absolute path.
 */
export declare function appendDisciplineEntry(config: HarnessConfig, projectRoot: string, entry: DisciplineEntry): AppendDisciplineResult;
//# sourceMappingURL=ledger.d.ts.map