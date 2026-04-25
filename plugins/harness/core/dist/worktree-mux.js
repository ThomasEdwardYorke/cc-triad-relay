/**
 * core/src/worktree-mux.ts
 *
 * `harness worktree-mux` subcommand: list git worktrees and open each in a
 * terminal multiplexer pane. cmux is preferred (column-based, semantically
 * suited for parallel worktree development), tmux is the universal fallback,
 * and a degraded text-output mode is provided when neither is installed.
 */
import { execSync } from "node:child_process";
const DEFAULT_CMUX_TEMPLATE = "cmux open --column {path}";
const DEFAULT_TMUX_SESSION = "harness-worktrees";
/**
 * Build an executable plan for `worktree-mux`. Pure function — relies on
 * injected dependencies for git invocation and command detection so that
 * tests do not require a live git repository or installed multiplexers.
 */
export function planWorktreeMux(opts) {
    const detect = opts.commandDetector ?? defaultCommandDetector;
    const fetchPorcelain = opts.worktreeListSource ?? defaultWorktreeListSource;
    const detection = resolveMultiplexer(opts.multiplexer, detect);
    if (detection.error) {
        return {
            success: false,
            multiplexerUsed: "degraded",
            worktrees: [],
            commands: [],
            warnings: [],
            error: detection.error,
        };
    }
    let porcelain;
    try {
        porcelain = fetchPorcelain();
    }
    catch (err) {
        return {
            success: false,
            multiplexerUsed: "degraded",
            worktrees: [],
            commands: [],
            warnings: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
    const { worktrees, warnings } = parsePorcelain(porcelain);
    if (worktrees.length === 0) {
        return {
            success: true,
            multiplexerUsed: detection.kind,
            worktrees: [],
            commands: [],
            warnings,
            error: "No worktrees found",
        };
    }
    const commands = buildCommands(detection.kind, worktrees, opts.withClaude, opts.cmuxCommandTemplate ?? DEFAULT_CMUX_TEMPLATE, opts.tmuxSessionName ?? DEFAULT_TMUX_SESSION);
    return {
        success: true,
        multiplexerUsed: detection.kind,
        worktrees,
        commands,
        warnings,
    };
}
/**
 * Execute the plan returned by `planWorktreeMux`.
 *
 * - degraded mode: prints worktrees and an install hint to stdout/stderr.
 * - cmux/tmux: runs each command via execSync. Returns 0 on success,
 *   non-zero on the first failed command.
 */
export function runPlan(plan, out = (m) => process.stdout.write(m + "\n"), warn = (m) => process.stderr.write(m + "\n"), exec = (cmd) => {
    execSync(cmd, { stdio: "inherit" });
}) {
    if (!plan.success) {
        if (plan.error)
            warn(`harness worktree-mux: ${plan.error}`);
        return 1;
    }
    for (const w of plan.warnings) {
        warn(`harness worktree-mux: ${w}`);
    }
    if (plan.error === "No worktrees found") {
        out("No worktrees found");
        return 0;
    }
    if (plan.multiplexerUsed === "degraded") {
        out("Multiplexer not available. Worktrees:");
        for (const wt of plan.worktrees) {
            out(`  ${wt}`);
        }
        warn("Install one of:");
        warn("  cmux: https://cmux.com");
        warn("  tmux: brew install tmux  (or apt-get install tmux)");
        return 0;
    }
    for (const cmd of plan.commands) {
        try {
            exec(cmd);
        }
        catch (err) {
            warn(`command failed: ${cmd}`);
            warn(String(err));
            return 1;
        }
    }
    return 0;
}
function resolveMultiplexer(requested, detect) {
    if (requested === "cmux") {
        if (!detect("cmux")) {
            return {
                kind: "degraded",
                error: "cmux not found. Install: https://cmux.com",
            };
        }
        return { kind: "cmux" };
    }
    if (requested === "tmux") {
        if (!detect("tmux")) {
            return {
                kind: "degraded",
                error: "tmux not found. Install: brew install tmux  (or apt-get install tmux)",
            };
        }
        return { kind: "tmux" };
    }
    // auto
    if (detect("cmux"))
        return { kind: "cmux" };
    if (detect("tmux"))
        return { kind: "tmux" };
    return { kind: "degraded" };
}
/**
 * Parse `git worktree list --porcelain` output. Each worktree is described by
 * a multi-line record, records are separated by blank lines, and the first
 * line of each record is `worktree <path>`. Records that do not start with a
 * `worktree` line are skipped with a warning.
 */
export function parsePorcelain(porcelain) {
    const worktrees = [];
    const warnings = [];
    const blocks = porcelain.replace(/\r\n/g, "\n").split(/\n\n+/);
    for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed)
            continue;
        const lines = trimmed.split("\n");
        const wtLine = lines[0];
        if (wtLine && wtLine.startsWith("worktree ")) {
            const path = wtLine.slice("worktree ".length).trim();
            if (path)
                worktrees.push(path);
            else
                warnings.push("worktree line had empty path");
        }
        else {
            warnings.push(`skipping malformed block (first line: ${JSON.stringify(lines[0] ?? "")})`);
        }
    }
    return { worktrees, warnings };
}
function buildCommands(kind, worktrees, withClaude, cmuxTemplate, tmuxSession) {
    if (kind === "degraded")
        return [];
    const claudeRunCmd = "claude; exec $SHELL";
    if (kind === "cmux") {
        return worktrees.map((wt) => {
            const base = cmuxTemplate.replace("{path}", shellQuote(wt));
            return withClaude ? `${base} -- ${shellQuote(claudeRunCmd)}` : base;
        });
    }
    // tmux: first worktree creates a detached session, subsequent ones split
    // the window horizontally inside that session. The session is killed
    // first if one with the same name already exists so that re-running
    // `harness worktree-mux` does not fail with "duplicate session". The
    // `|| true` makes the kill-session call idempotent for the
    // first-time path where the session does not exist yet.
    const result = [];
    const target = shellQuote(tmuxSession);
    worktrees.forEach((wt, i) => {
        const path = shellQuote(wt);
        if (i === 0) {
            result.push(`tmux kill-session -t ${target} 2>/dev/null || true`);
            result.push(withClaude
                ? `tmux new-session -d -s ${target} -c ${path} ${shellQuote(claudeRunCmd)}`
                : `tmux new-session -d -s ${target} -c ${path}`);
            return;
        }
        result.push(withClaude
            ? `tmux split-window -t ${target} -h -c ${path} ${shellQuote(claudeRunCmd)}`
            : `tmux split-window -t ${target} -h -c ${path}`);
    });
    // Bring the session to the foreground so the panes become visible.
    // switch-client when the caller is already inside tmux, attach-session
    // otherwise. POSIX `if`/`then`/`else` is portable across `sh -c`.
    result.push(`if [ -n "$TMUX" ]; then tmux switch-client -t ${target}; else tmux attach-session -t ${target}; fi`);
    return result;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function defaultCommandDetector(cmd) {
    // Defensive validation: although `resolveMultiplexer` only feeds the
    // hard-coded names "cmux" and "tmux" today, accepting arbitrary
    // strings would let a future caller smuggle shell metacharacters
    // through the `command -v ${cmd}` interpolation. Restricting the
    // input to a strict allowlist closes that path without changing the
    // behaviour for the in-tree call sites.
    if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
        return false;
    }
    try {
        execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" });
        return true;
    }
    catch {
        return false;
    }
}
function defaultWorktreeListSource() {
    try {
        return execSync("git worktree list --porcelain", {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    catch (err) {
        // Throw so planWorktreeMux can return success: false and runPlan can
        // exit non-zero. Returning "" would collapse "git unavailable / not a
        // repo / permission failure" into the legitimate "no worktrees
        // configured" path and make automation treat the failure as success.
        throw new Error(`failed to read git worktrees: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=worktree-mux.js.map