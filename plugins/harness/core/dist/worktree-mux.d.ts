/**
 * core/src/worktree-mux.ts
 *
 * `harness worktree-mux` subcommand: list git worktrees and open each in a
 * terminal multiplexer pane. cmux is preferred (column-based, semantically
 * suited for parallel worktree development), tmux is the universal fallback,
 * and a degraded text-output mode is provided when neither is installed.
 */
export type Multiplexer = "cmux" | "tmux" | "auto";
export interface WorktreeMuxOptions {
    multiplexer: Multiplexer;
    withClaude: boolean;
    worktreeListSource?: () => string;
    commandDetector?: (cmd: string) => boolean;
    cmuxCommandTemplate?: string;
    tmuxSessionName?: string;
}
export interface WorktreeMuxPlan {
    success: boolean;
    multiplexerUsed: "cmux" | "tmux" | "degraded";
    worktrees: string[];
    commands: string[];
    warnings: string[];
    error?: string;
}
/**
 * Build an executable plan for `worktree-mux`. Pure function — relies on
 * injected dependencies for git invocation and command detection so that
 * tests do not require a live git repository or installed multiplexers.
 */
export declare function planWorktreeMux(opts: WorktreeMuxOptions): WorktreeMuxPlan;
/**
 * Execute the plan returned by `planWorktreeMux`.
 *
 * - degraded mode: prints worktrees and an install hint to stdout/stderr.
 * - cmux/tmux: runs each command via execSync. Returns 0 on success,
 *   non-zero on the first failed command.
 */
export declare function runPlan(plan: WorktreeMuxPlan, out?: (msg: string) => void, warn?: (msg: string) => void, exec?: (cmd: string) => void): number;
interface ParseResult {
    worktrees: string[];
    warnings: string[];
}
/**
 * Parse `git worktree list --porcelain` output. Each worktree is described by
 * a multi-line record, records are separated by blank lines, and the first
 * line of each record is `worktree <path>`. Records that do not start with a
 * `worktree` line are skipped with a warning.
 */
export declare function parsePorcelain(porcelain: string): ParseResult;
export {};
//# sourceMappingURL=worktree-mux.d.ts.map