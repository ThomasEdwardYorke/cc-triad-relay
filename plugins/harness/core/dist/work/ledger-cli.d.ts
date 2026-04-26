/**
 * core/src/work/ledger-cli.ts
 *
 * Shell-side entrypoint for the discipline-ledger writer. Skills that
 * detect a violation (e.g. `/harness-merge-train` fail-fast paths)
 * shell out to this CLI so they do not have to re-implement path
 * validation or markdown formatting.
 *
 * Usage:
 *   node dist/work/ledger-cli.js append \
 *     --session <slug> \
 *     --skill <id> \
 *     --impact <text> \
 *     --remediation <text> \
 *     [--date <iso-date>] \
 *     [--project-root <abs>]
 *
 * Exit codes:
 *   0 — entry appended OR no-op (path unconfigured)
 *   1 — runtime error (validation failure, fs error)
 *   2 — usage error (bad argv)
 *
 * The pure `runLedgerCli(argv, opts)` function is the one under test.
 * The bottom of the file forwards `process.argv` / IO so the same
 * module can be invoked directly via `node` / `tsx`.
 */
export interface RunLedgerCliOptions {
    /** Working directory used as a fallback for `--project-root`. */
    cwd: string;
    /** Stdout writer (one logical line per call). */
    stdout: (line: string) => void;
    /** Stderr writer (one logical line per call). */
    stderr: (line: string) => void;
}
/**
 * Execute the ledger CLI against an in-memory IO surface. Returns the
 * exit code instead of calling `process.exit` so unit tests can assert
 * the contract without forking a subprocess.
 */
export declare function runLedgerCli(argv: readonly string[], opts: RunLedgerCliOptions): number;
//# sourceMappingURL=ledger-cli.d.ts.map