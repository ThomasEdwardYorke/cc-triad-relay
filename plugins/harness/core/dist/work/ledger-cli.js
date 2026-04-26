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
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigWithError } from "../config.js";
import { appendDisciplineEntry } from "./ledger.js";
const REQUIRED_APPEND_FLAGS = [
    "session",
    "skill",
    "impact",
    "remediation",
];
const OPTIONAL_APPEND_FLAGS = ["date", "project-root"];
const KNOWN_APPEND_FLAGS = new Set([
    ...REQUIRED_APPEND_FLAGS,
    ...OPTIONAL_APPEND_FLAGS,
]);
const USAGE = [
    "usage: ledger-cli append \\",
    "  --session <slug> \\",
    "  --skill <id> \\",
    "  --impact <text> \\",
    "  --remediation <text> \\",
    "  [--date <iso-date>] \\",
    "  [--project-root <abs>]",
].join("\n");
/**
 * Execute the ledger CLI against an in-memory IO surface. Returns the
 * exit code instead of calling `process.exit` so unit tests can assert
 * the contract without forking a subprocess.
 */
export function runLedgerCli(argv, opts) {
    const [subcommand, ...rest] = argv;
    if (subcommand === undefined) {
        opts.stderr(USAGE);
        return 2;
    }
    if (subcommand !== "append") {
        opts.stderr(`unknown subcommand "${subcommand}"`);
        opts.stderr(USAGE);
        return 2;
    }
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === undefined) {
            // Unreachable: bounded by `i < rest.length`. Kept for the
            // `noUncheckedIndexedAccess` compiler check.
            break;
        }
        if (!arg.startsWith("--")) {
            opts.stderr(`unexpected positional argument "${arg}"`);
            opts.stderr(USAGE);
            return 2;
        }
        const body = arg.slice(2);
        // GNU-style `--key=value` short-circuits the next-arg lookup so
        // shell scripts that quote the entire token (`"--session=$slug"`)
        // and downstream callers using either form both work.
        const eqIdx = body.indexOf("=");
        if (eqIdx !== -1) {
            const inlineKey = body.slice(0, eqIdx);
            const inlineValue = body.slice(eqIdx + 1);
            if (!KNOWN_APPEND_FLAGS.has(inlineKey)) {
                opts.stderr(`unknown flag --${inlineKey}`);
                opts.stderr(USAGE);
                return 2;
            }
            if (inlineValue === "") {
                opts.stderr(`flag --${inlineKey} is missing its value`);
                return 2;
            }
            flags[inlineKey] = inlineValue;
            continue;
        }
        const key = body;
        if (!KNOWN_APPEND_FLAGS.has(key)) {
            opts.stderr(`unknown flag --${key}`);
            opts.stderr(USAGE);
            return 2;
        }
        const value = rest[i + 1];
        if (value === undefined || value.startsWith("--")) {
            opts.stderr(`flag --${key} is missing its value`);
            return 2;
        }
        flags[key] = value;
        i += 1;
    }
    // Collect required flag values into a typed bucket so the post-loop
    // body sees `string` (not `string | undefined`) under
    // `noUncheckedIndexedAccess`. The early `return 2` ensures `required`
    // is fully populated by the time the entry is built.
    const required = {
        session: "",
        skill: "",
        impact: "",
        remediation: "",
    };
    for (const k of REQUIRED_APPEND_FLAGS) {
        const value = flags[k];
        if (value === undefined) {
            opts.stderr(`missing required flag --${k}`);
            opts.stderr(USAGE);
            return 2;
        }
        required[k] = value;
    }
    const projectRoot = flags["project-root"] ?? opts.cwd;
    // Absolute-path enforcement at parse time so a misconfigured caller
    // gets a usage error (exit 2) instead of falling through to the
    // ledger writer's runtime check (exit 1). The runtime guard inside
    // `appendDisciplineEntry` stays as defence-in-depth.
    if (!isAbsolute(projectRoot)) {
        opts.stderr(`--project-root must be an absolute path; got "${projectRoot}"`);
        opts.stderr(USAGE);
        return 2;
    }
    const date = flags.date ?? new Date().toISOString().slice(0, 10);
    const entry = {
        date,
        session: required.session,
        skillId: required.skill,
        impact: required.impact,
        remediation: required.remediation,
    };
    // The audit ledger must never silently swallow a corrupt
    // harness.config.json: a broken file would otherwise be treated as
    // "no path configured" and the violation would never reach the
    // ledger. `loadConfigWithError` distinguishes "absent" (valid
    // opt-in-to-defaults state) from "broken" (parse / I/O failure) so
    // the CLI can fail loudly only on the latter.
    const outcome = loadConfigWithError(projectRoot);
    if (outcome.error !== undefined) {
        opts.stderr(`harness.config.json could not be loaded: ${outcome.error}`);
        return 1;
    }
    const config = outcome.config;
    try {
        const result = appendDisciplineEntry(config, projectRoot, entry);
        if (result.status === "no-op-no-config") {
            opts.stdout(`ledger no-op: ${result.reason}`);
            return 0;
        }
        opts.stdout(`ledger appended: ${result.ledgerPath}`);
        return 0;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.stderr(message);
        return 1;
    }
}
// `import.meta.url === url(process.argv[1])` is the canonical "is-this
// the entrypoint?" check for ESM modules. When tsx / node executes
// this file directly, run the CLI; when imported (test, build) we
// just export the function above.
const invokedAsScript = typeof process !== "undefined" &&
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
    const code = runLedgerCli(process.argv.slice(2), {
        cwd: process.cwd(),
        stdout: (s) => process.stdout.write(`${s}\n`),
        stderr: (s) => process.stderr.write(`${s}\n`),
    });
    process.exit(code);
}
//# sourceMappingURL=ledger-cli.js.map