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

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

export type AppendDisciplineResult =
  | AppendDisciplineSuccess
  | AppendDisciplineNoOp;

/** Markdown header for a freshly-created ledger file. */
const LEDGER_HEADER = [
  "# Discipline ledger",
  "",
  "Append-only record of harness discipline violations detected by",
  "/harness-merge-train and related skills. Each row captures a single",
  "fallback / bypass event so audit trails survive across sessions.",
  "",
  "| Date | Session | Skill | Impact | Remediation |",
  "|---|---|---|---|---|",
].join("\n");

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
export function appendDisciplineEntry(
  config: HarnessConfig,
  projectRoot: string,
  entry: DisciplineEntry,
): AppendDisciplineResult {
  const ledgerRel = config.work?.qualityGates?.disciplineLedgerPath;

  if (ledgerRel === undefined || ledgerRel === "") {
    return {
      status: "no-op-no-config",
      reason: "work.qualityGates.disciplineLedgerPath is not configured",
    };
  }

  if (!isAbsolute(projectRoot)) {
    throw new Error(
      `appendDisciplineEntry: projectRoot must be absolute, got "${projectRoot}"`,
    );
  }

  if (isAbsolute(ledgerRel)) {
    throw new Error(
      `appendDisciplineEntry: disciplineLedgerPath must be project-relative, got absolute path "${ledgerRel}"`,
    );
  }

  // Reject any segment that is exactly `..` — that handles both
  // `../foo` and `subdir/../../escape.md` before any filesystem touch.
  const segments = ledgerRel.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) {
    throw new Error(
      `appendDisciplineEntry: disciplineLedgerPath cannot escape projectRoot via parent traversal "${ledgerRel}"`,
    );
  }

  const ledgerAbs = resolve(projectRoot, ledgerRel);

  // Defence in depth: even after segment filtering, double-check the
  // resolved path lives under projectRoot. Catches odd inputs that
  // might still resolve outside (`//etc/passwd` on POSIX, drive
  // letters on Windows, etc.).
  const rel = relative(projectRoot, ledgerAbs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
      `appendDisciplineEntry: disciplineLedgerPath escapes projectRoot "${ledgerRel}" → "${ledgerAbs}"`,
    );
  }

  const row = formatEntry(entry);
  const parent = dirname(ledgerAbs);
  mkdirSync(parent, { recursive: true });

  // Resolve projectRoot's *real* path once so the symlink-rejection
  // checks below compare apples to apples. macOS keeps `/tmp` as a
  // symlink to `/private/tmp`, so a caller passing a `/tmp/...`
  // projectRoot would otherwise see every realpath result classified
  // as "outside" via the `/private/tmp/...` prefix mismatch.
  const realProjectRoot = realpathSync(projectRoot);

  // Symlink defence (post-mkdirSync): once the parent dir exists,
  // resolve its real path. If the real path lives outside projectRoot
  // the writer refuses — a malicious symlink on disk could otherwise
  // make the textual `relative()` check pass while the actual writes
  // land somewhere unexpected.
  assertWithinProjectRoot(
    realpathSync(parent),
    realProjectRoot,
    ledgerRel,
    "parent",
  );

  if (existsSync(ledgerAbs)) {
    // `lstatSync` follows no symlinks — `isSymbolicLink()` is the only
    // reliable Node.js test. Refusing all ledger symlinks (rather than
    // resolving + re-checking) keeps the policy auditable: a symlinked
    // ledger is never a legitimate configuration in this writer.
    if (lstatSync(ledgerAbs).isSymbolicLink()) {
      throw new Error(
        `appendDisciplineEntry: existing ledger "${ledgerAbs}" is a symlink (refusing to follow)`,
      );
    }
    // TOCTOU mitigation: the ledger file existed at the lstat call
    // above, but a racing actor could have replaced it. Resolve once
    // more and re-check the boundary. Native O_NOFOLLOW would be
    // stronger but Node.js's high-level fs API does not expose it.
    assertWithinProjectRoot(
      realpathSync(ledgerAbs),
      realProjectRoot,
      ledgerRel,
      "ledger",
    );
  }

  if (!existsSync(ledgerAbs)) {
    // `wx` flag => fail if file already exists. On a race the loser
    // falls through to the append branch below.
    try {
      writeFileSync(ledgerAbs, `${LEDGER_HEADER}\n${row}\n`, { flag: "wx" });
      return { status: "appended", ledgerPath: ledgerAbs };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      // fall through to append
    }
  }

  appendFileSync(ledgerAbs, `${row}\n`);
  return { status: "appended", ledgerPath: ledgerAbs };
}

/**
 * Throw if the resolved real path no longer sits under `projectRoot`.
 * The same check is shared by the parent-dir post-mkdir verification
 * and the pre-write existing-ledger TOCTOU re-check.
 */
function assertWithinProjectRoot(
  realPath: string,
  projectRoot: string,
  ledgerRel: string,
  kind: "parent" | "ledger",
): void {
  const realRel = relative(projectRoot, realPath);
  if (
    realRel.startsWith("..") ||
    realRel.startsWith(`..${sep}`) ||
    isAbsolute(realRel)
  ) {
    throw new Error(
      `appendDisciplineEntry: ${kind} of "${ledgerRel}" resolves to "${realPath}" outside projectRoot via symlink (refusing)`,
    );
  }
}

/**
 * Format one ledger row. Pipes are escaped so they do not break the
 * markdown table; CR/LF inside any field are collapsed to single
 * spaces so each entry stays on a single line.
 */
function formatEntry(entry: DisciplineEntry): string {
  const escape = (s: string): string =>
    s.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, " ");
  return `| ${escape(entry.date)} | ${escape(entry.session)} | ${escape(entry.skillId)} | ${escape(entry.impact)} | ${escape(entry.remediation)} |`;
}
