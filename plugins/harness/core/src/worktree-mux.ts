/**
 * core/src/worktree-mux.ts
 *
 * `harness worktree-mux` subcommand: list git worktrees and open each in a
 * terminal multiplexer pane. cmux is preferred (column-based, semantically
 * suited for parallel worktree development), tmux is the universal fallback,
 * and a degraded text-output mode is provided when neither is installed.
 */

import { execSync } from "node:child_process";

export type Multiplexer = "cmux" | "tmux" | "auto";

export interface WorktreeMuxOptions {
  multiplexer: Multiplexer;
  withClaude: boolean;
  // Dependency injection for testing.
  worktreeListSource?: () => string;
  commandDetector?: (cmd: string) => boolean;
  /**
   * Template for the cmux invocation. `{path}` is replaced with the
   * shell-quoted worktree path; the result is passed to `execSync` as a
   * shell command. The default value is a best-effort hypothesis based on
   * the cmux CLI shape; verify against your installed version and
   * override via the `CMUX_CMD_TEMPLATE` env var if the cmux release you
   * use exposes a different sub-command.
   */
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

const DEFAULT_CMUX_TEMPLATE = "cmux open --column {path}";
const DEFAULT_TMUX_SESSION = "harness-worktrees";

/**
 * Build an executable plan for `worktree-mux`. Pure function — relies on
 * injected dependencies for git invocation and command detection so that
 * tests do not require a live git repository or installed multiplexers.
 */
export function planWorktreeMux(opts: WorktreeMuxOptions): WorktreeMuxPlan {
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

  const porcelain = fetchPorcelain();
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

  const commands = buildCommands(
    detection.kind,
    worktrees,
    opts.withClaude,
    opts.cmuxCommandTemplate ?? DEFAULT_CMUX_TEMPLATE,
    opts.tmuxSessionName ?? DEFAULT_TMUX_SESSION,
  );

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
export function runPlan(
  plan: WorktreeMuxPlan,
  out: (msg: string) => void = (m) => process.stdout.write(m + "\n"),
  warn: (msg: string) => void = (m) => process.stderr.write(m + "\n"),
  exec: (cmd: string) => void = (cmd) => {
    execSync(cmd, { stdio: "inherit" });
  },
): number {
  if (!plan.success) {
    if (plan.error) warn(`harness worktree-mux: ${plan.error}`);
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
    warn("  cmux: https://cmux.com/ja");
    warn("  tmux: brew install tmux  (or apt-get install tmux)");
    return 0;
  }

  for (const cmd of plan.commands) {
    try {
      exec(cmd);
    } catch (err) {
      warn(`command failed: ${cmd}`);
      warn(String(err));
      return 1;
    }
  }
  return 0;
}

interface MultiplexerResolution {
  kind: "cmux" | "tmux" | "degraded";
  error?: string;
}

function resolveMultiplexer(
  requested: Multiplexer,
  detect: (cmd: string) => boolean,
): MultiplexerResolution {
  if (requested === "cmux") {
    if (!detect("cmux")) {
      return {
        kind: "degraded",
        error: "cmux not found. Install: https://cmux.com/ja",
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
  if (detect("cmux")) return { kind: "cmux" };
  if (detect("tmux")) return { kind: "tmux" };
  return { kind: "degraded" };
}

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
export function parsePorcelain(porcelain: string): ParseResult {
  const worktrees: string[] = [];
  const warnings: string[] = [];

  const blocks = porcelain.split(/\n\n+/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const wtLine = lines[0];
    if (wtLine && wtLine.startsWith("worktree ")) {
      const path = wtLine.slice("worktree ".length).trim();
      if (path) worktrees.push(path);
      else warnings.push("worktree line had empty path");
    } else {
      warnings.push(
        `skipping malformed block (first line: ${JSON.stringify(lines[0] ?? "")})`,
      );
    }
  }

  return { worktrees, warnings };
}

function buildCommands(
  kind: "cmux" | "tmux" | "degraded",
  worktrees: string[],
  withClaude: boolean,
  cmuxTemplate: string,
  tmuxSession: string,
): string[] {
  if (kind === "degraded") return [];

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
  const result: string[] = [];
  worktrees.forEach((wt, i) => {
    const path = shellQuote(wt);
    const target = shellQuote(tmuxSession);
    if (i === 0) {
      result.push(`tmux kill-session -t ${target} 2>/dev/null || true`);
      result.push(
        withClaude
          ? `tmux new-session -d -s ${target} -c ${path} ${shellQuote(claudeRunCmd)}`
          : `tmux new-session -d -s ${target} -c ${path}`,
      );
      return;
    }
    result.push(
      withClaude
        ? `tmux split-window -t ${target} -h -c ${path} ${shellQuote(claudeRunCmd)}`
        : `tmux split-window -t ${target} -h -c ${path}`,
    );
  });
  return result;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function defaultCommandDetector(cmd: string): boolean {
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
  } catch {
    return false;
  }
}

function defaultWorktreeListSource(): string {
  try {
    return execSync("git worktree list --porcelain", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Distinguish "git not on PATH or current directory is not a repo"
    // from "repository has no worktrees configured" by surfacing the
    // failure to stderr. Callers (planWorktreeMux) still observe an
    // empty string and report "No worktrees found", but the operator
    // sees the underlying reason instead of a silent miss.
    process.stderr.write(
      `[harness worktree-mux] failed to read git worktrees: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return "";
  }
}
