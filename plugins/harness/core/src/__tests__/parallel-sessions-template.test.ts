/**
 * core/src/__tests__/parallel-sessions-template.test.ts
 *
 * Shell-exec contract test for `scripts/parallel-sessions-template.sh`.
 *
 * 目的:
 *   tmux-based 並列 session launcher の bash template が
 *   start / stop / status / attach の 4 subcommand と --dry-run / --help を
 *   提供することを CI で固定する。実 tmux / git worktree を起動せずに
 *   --dry-run で plan を verify することで、外部依存ゼロの test 環境で
 *   contract drift を検出する。
 *
 * Implementation invariants:
 *   - `set -euo pipefail` (shell strict mode)
 *   - `--dry-run` flag が tmux / git worktree を実行せず print only
 *   - Generic placeholders (`<your-project>` / `<slug>` / `<feature_branch>`)
 *   - parts-management 等の test-bed 固有 token は不在 (B-1 〜 B-3g)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const SCRIPT_PATH = resolve(PLUGIN_ROOT, "scripts/parallel-sessions-template.sh");

function runScript(
  args: string[] = [],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bash", [SCRIPT_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env, LC_ALL: "C", LANG: "C" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("parallel-sessions-template.sh: file existence and shape", () => {
  it("script file exists", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it("starts with bash shebang", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    expect(content).toMatch(/^#!\/usr\/bin\/env\s+bash/);
  });

  it("uses strict mode (set -euo pipefail)", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    expect(content).toMatch(/set\s+-euo\s+pipefail/);
  });
});

describe("parallel-sessions-template.sh: --help / usage contract", () => {
  it("--help prints usage and exits 0", () => {
    const r = runScript(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/i);
  });

  it("no args prints usage", () => {
    const r = runScript([]);
    // accept either status 0 (no-args == help) or status 1 (no-args == error
    // showing usage to stderr); either way usage text must appear.
    expect(r.stdout + r.stderr).toMatch(/Usage:/i);
  });

  it("usage references all 4 subcommands (start / stop / status / attach)", () => {
    const r = runScript(["--help"]);
    expect(r.stdout).toMatch(/\bstart\b/);
    expect(r.stdout).toMatch(/\bstop\b/);
    expect(r.stdout).toMatch(/\bstatus\b/);
    expect(r.stdout).toMatch(/\battach\b/);
  });

  it("usage references --dry-run flag", () => {
    const r = runScript(["--help"]);
    expect(r.stdout).toMatch(/--dry-run/);
  });
});

describe("parallel-sessions-template.sh: subcommand routing", () => {
  it("unknown subcommand prints error to stderr and exits non-zero", () => {
    const r = runScript(["garbage-cmd"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/[Uu]nknown|[Ii]nvalid/);
  });

  it("start without args prints error and shows usage", () => {
    const r = runScript(["start"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Usage:|requires|missing/i);
  });
});

describe("parallel-sessions-template.sh: --dry-run start", () => {
  it("dry-run start prints planned worktree paths and tmux windows", () => {
    const r = runScript([
      "--dry-run",
      "start",
      "main",
      "frontend",
      "backend",
    ]);
    expect(r.status).toBe(0);
    // both slug names appear in plan
    expect(r.stdout).toMatch(/frontend/);
    expect(r.stdout).toMatch(/backend/);
    // base feature branch appears
    expect(r.stdout).toMatch(/main/);
    // mention of tmux session and worktree creation steps
    expect(r.stdout).toMatch(/tmux/i);
    expect(r.stdout).toMatch(/worktree/i);
  });

  it("dry-run start references claude session launch", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/claude/i);
  });

  it("dry-run does NOT execute tmux / git worktree (no side effects)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"]);
    // dry-run output should not include error from tmux/git failure
    expect(r.stderr).not.toMatch(/fatal:/i);
    expect(r.stderr).not.toMatch(/no\s+server/i);
  });
});

describe("parallel-sessions-template.sh: env var configuration", () => {
  it("respects TMUX_SESSION_NAME env var (visible in dry-run plan)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_SESSION_NAME: "my-custom-session-xyz",
    });
    expect(r.stdout).toMatch(/my-custom-session-xyz/);
  });

  it("respects WORKTREE_PARENT_DIR env var", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      WORKTREE_PARENT_DIR: "/tmp/<test-stub>/parent",
    });
    expect(r.stdout).toMatch(/\/tmp\/<test-stub>\/parent/);
  });

  it("respects WORKTREE_PREFIX env var", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      WORKTREE_PREFIX: "myprefix-wt-",
    });
    expect(r.stdout).toMatch(/myprefix-wt-/);
  });
});

describe("parallel-sessions-template.sh: generic spec hygiene", () => {
  const content = readFileSync(SCRIPT_PATH, "utf-8");

  it("does not leak parts-management / test-bed names", () => {
    expect(content).not.toMatch(/parts-management/i);
    expect(content).not.toMatch(/feature\/new-partslist/);
  });

  it("does not leak internal tracker IDs (Round N / 申送 M-NN / A-N rM)", () => {
    expect(content).not.toMatch(/\bRound\s*\d+\b/);
    expect(content).not.toMatch(/申送\s*[A-Z]-\d+/);
    expect(content).not.toMatch(/\b[Aa]-\d+\s*r\d+/);
  });

  it("uses generic placeholders for slug / project / feature branch", () => {
    expect(content).toMatch(/<slug>|\$\{?slug\}?|\$\{?SLUG\}?/);
  });
});

describe("parallel-sessions-template.sh: input validation (injection prevention)", () => {
  it("rejects slug containing shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "foo;rm"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error/i);
  });

  // Skipped on Windows: MSYS2 / Git Bash performs quote-removal on argv
  // passed from native Windows apps (Node.js spawnSync) into the POSIX
  // context, so a literal single-quote in argv is stripped before the bash
  // script receives it (foo'bar -> foobar). Other metacharacters (";",
  // whitespace) survive because they are not POSIX quoting-context toggles.
  // The character-class correctness of validate_identifier is verified
  // separately by the Windows-safe regex-contract test below (file-content
  // based, no spawn). Refs: msys2/msys2-runtime quote-removal, Cygwin
  // runtime POSIX semantics.
  it.skipIf(process.platform === "win32")(
    "rejects slug containing single-quote (would break out of '$slug' wrapper)",
    () => {
      const r = runScript(["--dry-run", "start", "main", "foo'bar"]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/invalid\s+characters|Error/i);
    },
  );

  it("validate_identifier regex character class denies single-quote (Windows-safe contract)", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    // Match the validate_identifier regex character class:
    //   [[ ! "$val" =~ ^[<charset>]+$ ]]
    const validatorMatch = content.match(
      /validate_identifier\(\)\s*\{[\s\S]*?\[\[\s*!\s*"\$val"\s*=~\s*\^\[([^\]]+)\]\+\$\s*\]\]/,
    );
    expect(validatorMatch).not.toBeNull();
    const charClass = validatorMatch![1];
    // Single-quote (U+0027) MUST NOT be in the allowed character class
    expect(charClass).not.toContain("'");
    // Baseline: a-z / A-Z / 0-9 must be allowed
    expect(charClass).toContain("a-z");
    expect(charClass).toContain("A-Z");
    expect(charClass).toContain("0-9");
  });

  it("rejects slug containing whitespace", () => {
    const r = runScript(["--dry-run", "start", "main", "foo bar"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error/i);
  });

  it("rejects feature branch containing .. (git ref invalid)", () => {
    const r = runScript(["--dry-run", "start", "feat..branch", "alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/contains\s+'\.\.'|Error/i);
  });

  it("rejects feature branch starting with - (git ref invalid)", () => {
    const r = runScript(["--dry-run", "start", "-evil", "alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must\s+not\s+start\s+with|Error/i);
  });

  it("rejects feature branch containing shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "feat;rm", "alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error/i);
  });

  it("rejects CLAUDE_MODEL containing shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_MODEL: "gpt-4; rm -rf /",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error|CLAUDE_MODEL/i);
  });

  it("rejects CLAUDE_MODEL containing command substitution", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_MODEL: "$(touch /tmp/pwned)",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error|CLAUDE_MODEL/i);
  });

  it("rejects unknown CLAUDE_PERMISSION_MODE", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_PERMISSION_MODE: "wildmode",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+CLAUDE_PERMISSION_MODE|Error/i);
  });

  it("rejects CLAUDE_PERMISSION_MODE with shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_PERMISSION_MODE: "auto; touch /tmp/pwned",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+CLAUDE_PERMISSION_MODE|Error/i);
  });

  it("accepts each documented CLAUDE_PERMISSION_MODE value", () => {
    for (const mode of [
      "acceptEdits",
      "auto",
      "bypassPermissions",
      "default",
      "dontAsk",
      "plan",
    ]) {
      const r = runScript(["--dry-run", "start", "main", "alpha"], {
        CLAUDE_PERMISSION_MODE: mode,
      });
      expect(r.status).toBe(0);
    }
  });

  it("attach subcommand validates slug input", () => {
    const r = runScript(["--dry-run", "attach", "foo;rm"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid\s+characters|Error/i);
  });
});

describe("parallel-sessions-template.sh: dry-run stop / status / attach", () => {
  it("dry-run stop prints the kill-session command without executing", () => {
    const r = runScript(["--dry-run", "stop"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/kill-session|tmux/i);
  });

  it("dry-run status prints list-windows command", () => {
    const r = runScript(["--dry-run", "status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/list-windows|status|tmux/i);
  });

  it("dry-run attach requires a slug argument", () => {
    const r = runScript(["--dry-run", "attach"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/slug|requires|missing/i);
  });

  it("dry-run attach with slug prints attach + select-window plan", () => {
    const r = runScript(["--dry-run", "attach", "frontend"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/attach|select-window/i);
    expect(r.stdout).toMatch(/frontend/);
  });
});
