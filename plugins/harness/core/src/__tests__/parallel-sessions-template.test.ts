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
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const SCRIPT_PATH = resolve(PLUGIN_ROOT, "scripts/parallel-sessions-template.sh");
const ROLLBACK_BRANCH_RECORD = "harness-generated-branch";
const ROLLBACK_SESSION_RECORD = "harness-session-name";

function rollbackTestSession(suffix: string): string {
  return `harness-rollback-test-${process.pid}-${suffix}`;
}

function writeRollbackRecord(worktree: string, fileName: string, value: string): void {
  const gitDir = spawnSync("git", ["-C", worktree, "rev-parse", "--git-dir"], {
    encoding: "utf-8",
  });
  expect(gitDir.status).toBe(0);
  writeFileSync(join(resolve(worktree, gitDir.stdout.trim()), fileName), `${value}\n`);
}

function writeRollbackBranchRecord(worktree: string, branch: string): void {
  writeRollbackRecord(worktree, ROLLBACK_BRANCH_RECORD, branch);
}

function writeRollbackSessionRecord(worktree: string, session: string): void {
  writeRollbackRecord(worktree, ROLLBACK_SESSION_RECORD, session);
}

function runScript(
  args: string[] = [],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  // Use a minimal env (PATH + LC_ALL + LANG only, plus per-test overrides)
  // instead of inheriting process.env. Inheriting the runner's environment
  // lets stray TMUX_PASS_ENV / CLAUDE_ONESHOT_LOG_DIR / CLAUDE_MODEL leak
  // into assertions about "no -e propagation" or "default model alias",
  // which makes the suite flaky on developer machines that happen to
  // export those vars in their interactive shells. The launcher only
  // depends on PATH for resolving `tmux` / `git` / `bash`, and on the
  // explicit overrides this helper accepts; everything else must come in
  // through `env`.
  const r = spawnSync("bash", [SCRIPT_PATH, ...args], {
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH ?? "",
      LC_ALL: "C",
      LANG: "C",
      ...env,
    },
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

  it("dry-run start records generated branches for rollback cleanup", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(ROLLBACK_BRANCH_RECORD));
    expect(r.stdout).toMatch(new RegExp(ROLLBACK_SESSION_RECORD));
    expect(r.stdout).toMatch(/feature\/main-alpha/);
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

  it("rejects TMUX_SESSION_NAME containing shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_SESSION_NAME: "bad';touch",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/tmux session name|invalid characters|Error/i);
    expect(r.stdout).not.toMatch(/new-session|new-window/);
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

  it("rejects slug containing dot because tmux target syntax reserves dot for panes", () => {
    const r = runScript(["--dry-run", "start", "main", "api.v2"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slug|invalid\s+characters|tmux/i);
  });

  it("validates every slug before emitting any start plan", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha", "api.v2"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slug|invalid\s+characters|tmux/i);
    expect(r.stdout).not.toMatch(/tmux new-session/);
    expect(r.stdout).not.toMatch(/git worktree add/);
    expect(r.stdout).not.toMatch(/tmux new-window/);
  });

  it("rejects slug starting with digit because tmux target syntax tries window indexes first", () => {
    const r = runScript(["--dry-run", "start", "main", "2alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slug|invalid\s+characters|tmux|start/i);
  });

  it("validate_slug regex denies dot and leading digit (tmux target-window compatibility)", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    const validatorMatch = content.match(
      /validate_slug\(\)\s*\{[\s\S]*?\[\[\s*!\s*"\$val"\s*=~\s*\^\[([^\]]+)\]\[([^\]]+)\]\*\$\s*\]\]/,
    );
    expect(validatorMatch).not.toBeNull();
    const firstCharClass = validatorMatch![1];
    const restCharClass = validatorMatch![2];
    expect(firstCharClass).not.toContain(".");
    expect(firstCharClass).not.toContain("0-9");
    expect(firstCharClass).toContain("a-z");
    expect(firstCharClass).toContain("A-Z");
    expect(restCharClass).not.toContain(".");
    expect(restCharClass).toContain("0-9");
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

describe("parallel-sessions-template.sh: tmux env propagation (-e)", () => {
  // tmux env propagation prerequisite. tmux otherwise filters out custom env
  // on session creation, so per-window claude (and any e2e smoke mock)
  // cannot see env vars the coordinator set unless the launcher pipes them
  // via `tmux new-session -e KEY=VAL`. These tests fix the contract so a
  // future regression that drops the `-e` propagation fails here, not
  // silently in production where the symptom is "log file written to /tmp
  // instead of the configured logDir".

  it("dry-run start propagates CLAUDE_ONESHOT_LOG_DIR via tmux -e", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_ONESHOT_LOG_DIR: "/tmp/oneshot-fixture-logs",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /-e\s+'?CLAUDE_ONESHOT_LOG_DIR=\/tmp\/oneshot-fixture-logs'?/,
    );
  });

  it("dry-run start omits -e when no propagated env is set", () => {
    // Run the script with a clean env so CLAUDE_ONESHOT_LOG_DIR is not
    // inherited from the outer test runner; otherwise the assertion is
    // meaningless on developer machines that happen to have it set.
    const r = spawnSync(
      "bash",
      [SCRIPT_PATH, "--dry-run", "start", "main", "alpha"],
      {
        encoding: "utf-8",
        env: { PATH: process.env.PATH ?? "", LC_ALL: "C", LANG: "C" },
      },
    );
    expect(r.status).toBe(0);
    const newSessionLine = (r.stdout ?? "")
      .split("\n")
      .find((l) => l.includes("new-session"));
    expect(newSessionLine).toBeDefined();
    expect(newSessionLine).not.toMatch(/-e\s+'?CLAUDE_ONESHOT_LOG_DIR=/);
  });

  it("respects TMUX_PASS_ENV whitelist for additional keys", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "MY_EXTRA_KEY",
      MY_EXTRA_KEY: "myvalue",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-e\s+'?MY_EXTRA_KEY=myvalue'?/);
  });

  it("propagates multiple keys from TMUX_PASS_ENV (whitespace-separated)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "KEY_A KEY_B",
      KEY_A: "valueA",
      KEY_B: "valueB",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-e\s+'?KEY_A=valueA'?/);
    expect(r.stdout).toMatch(/-e\s+'?KEY_B=valueB'?/);
  });

  it("rejects TMUX_PASS_ENV key with shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "EVIL;rm",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/POSIX|Error/i);
  });

  it("rejects TMUX_PASS_ENV key with hyphen (bash indirect expansion crash)", () => {
    // Bash 5 raises "bad substitution" on ${!BAD-KEY:-} which would crash
    // the launcher mid-loop. POSIX shell parameter names disallow hyphen.
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "BAD-KEY",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/POSIX|Error/i);
  });

  it("rejects TMUX_PASS_ENV key with dot (bash indirect expansion crash)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "BAD.KEY",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/POSIX|Error/i);
  });

  it("rejects TMUX_PASS_ENV key starting with a digit (POSIX violation)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "1BAD",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/POSIX|Error/i);
  });

  it("accepts TMUX_PASS_ENV key with leading underscore (POSIX-valid)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "_HIDDEN_KEY",
      _HIDDEN_KEY: "ok",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-e\s+'?_HIDDEN_KEY=ok'?/);
  });

  it("handles unset TMUX_PASS_ENV target key gracefully (no -e emitted)", () => {
    // TMUX_PASS_ENV declares MY_UNSET_KEY but the env var itself is not set.
    // resolve_tmux_env_args must not crash and must not emit `-e` for it.
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "MY_UNSET_KEY",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/-e\s+'?MY_UNSET_KEY=/);
  });

  it("propagates whitelisted key when value is empty string (set-but-empty)", () => {
    // `${!key:-}` + `-n` cannot distinguish "unset" from "set-but-empty",
    // so an operator who explicitly sets `MY_EMPTY=""` to override an
    // inherited value (e.g. unset a leaked secret in the child tmux
    // session) cannot see `-e MY_EMPTY=` propagated. Use `${!key+set}`
    // form to detect "is set" independent of the value being empty.
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      TMUX_PASS_ENV: "MY_EMPTY",
      MY_EMPTY: "",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-e\s+'?MY_EMPTY='?(?=\s|$)/m);
  });

  it("propagates CLAUDE_ONESHOT_LOG_DIR even when value is empty string", () => {
    // Symmetric case for the always-on allowlist key. Setting
    // CLAUDE_ONESHOT_LOG_DIR="" lets the operator force the child to fall
    // back to the default `/tmp` rather than inherit a stale dir from the
    // outer shell. The launcher must propagate the empty value rather than
    // silently dropping it.
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_ONESHOT_LOG_DIR: "",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-e\s+'?CLAUDE_ONESHOT_LOG_DIR='?(?=\s|$)/m);
  });

  it("rejects env value containing shell metacharacters", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_ONESHOT_LOG_DIR: "/tmp/foo;rm",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/contains characters outside|Error/i);
  });

  it("rejects env value containing single quotes (would break -e wrapping)", () => {
    const r = runScript(["--dry-run", "start", "main", "alpha"], {
      CLAUDE_ONESHOT_LOG_DIR: "/tmp/'evil'/x",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/contains characters outside|Error/i);
  });

  it("accepts path-safe env values (paths, KEY=VAL chains, comma lists)", () => {
    for (const val of [
      "/tmp/foo-bar/baz",
      "/var/log/harness.log",
      "FOO=1,BAR=2",
      "a@b.example.com",
      "v0.4.0+build.123",
    ]) {
      const r = runScript(["--dry-run", "start", "main", "alpha"], {
        CLAUDE_ONESHOT_LOG_DIR: val,
      });
      expect(r.status).toBe(0);
    }
  });
});

describe("parallel-sessions-template.sh: dry-run stop / status / attach", () => {
  it("dry-run stop prints the kill-session command without executing", () => {
    const r = runScript(["--dry-run", "stop"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/kill-session|tmux/i);
    expect(r.stdout).not.toMatch(/worktree\s+remove|branch\s+-D/);
  });

  it("stop without --rollback rejects extra positional arguments", () => {
    const r = runScript(["--dry-run", "stop", "harness-parallel", "alpha"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/at most one <session_name>|--rollback/i);
    expect(r.stdout).not.toMatch(/kill-session|worktree\s+remove|branch\s+-D/);
  });

  it("usage documents stop --rollback as explicit destructive rollback intent", () => {
    const r = runScript(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/stop\s+\[<session_name>\]/);
    expect(r.stdout).toMatch(/stop\s+--rollback\s+\[<session_name>\]/);
    expect(r.stdout).toMatch(/rollback/i);
    expect(r.stdout).toMatch(/branch cleanup|generated branch|git branch/i);
  });

  it("dry-run stop --rollback plans tmux stop, worktree removal, and generated branch cleanup", () => {
    const r = runScript(
      ["--dry-run", "stop", "--rollback", "harness-parallel", "api", "worker"],
      {
        WORKTREE_PARENT_DIR: "/tmp/harness-rollback",
        WORKTREE_PREFIX: "proj-wt-",
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\/tmp\/harness-rollback\/proj-wt-api/);
    expect(r.stdout).toMatch(/\/tmp\/harness-rollback\/proj-wt-worker/);
    expect(r.stdout).toMatch(new RegExp(ROLLBACK_BRANCH_RECORD));
    expect(r.stdout).toMatch(/git -C '.+proj-wt-api' branch --show-current/);
    expect(r.stdout).toMatch(/git worktree remove '.+proj-wt-api' --force/);
    expect(r.stdout).toMatch(/git branch -D -- "\$rollback_branch"/);
    expect(r.stdout).toMatch(/tmux kill-session -t 'harness-parallel'/);
  });

  it("dry-run stop --rollback requires explicit slugs so preview scope is not under-reported", () => {
    const r = runScript(["--dry-run", "stop", "--rollback", "harness-parallel"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/dry-run rollback cleanup requires explicit slugs/i);
    expect(r.stderr).not.toMatch(/shift/i);
    expect(r.stdout).not.toMatch(/no slugs discovered|worktree remove|branch -D|kill-session/);
  });

  it("stop --rollback validates explicit slug overrides before emitting commands", () => {
    const r = runScript(["--dry-run", "stop", "--rollback", "harness-parallel", "api.v2"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slug|invalid characters|Error/i);
    expect(r.stdout).not.toMatch(/worktree remove|branch -D|kill-session/);
  });

  it("stop --rollback treats missing explicit worktrees as no-op cleanup", () => {
    const missingParent = `/tmp/harness-rollback-missing-${process.pid}`;
    const r = runScript(["stop", "--rollback", rollbackTestSession("missing"), "ghost"], {
      WORKTREE_PARENT_DIR: missingParent,
      WORKTREE_PREFIX: "missing-wt-",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/worktree .*missing.*skip/i);
    expect(r.stdout).toMatch(/Cleanup complete/);
  });

  it.skipIf(process.platform === "win32")(
    "stop --rollback deletes only generated feature branches that end with the slug",
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), "harness-rollback-"));
      const session = rollbackTestSession("branches");
      const generatedWorktree = join(sandbox, "proj-wt-alpha");
      const manualWorktree = join(sandbox, "proj-wt-beta");
      try {
        spawnSync("git", ["init", "-q"], { cwd: sandbox });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: sandbox });
        spawnSync("git", ["config", "user.name", "Harness Test"], { cwd: sandbox });
        writeFileSync(join(sandbox, "README.md"), "base\n");
        spawnSync("git", ["add", "README.md"], { cwd: sandbox });
        spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: sandbox });
        spawnSync("git", ["worktree", "add", "-q", generatedWorktree, "-b", "feature/demo-alpha"], {
          cwd: sandbox,
        });
        writeRollbackBranchRecord(generatedWorktree, "feature/demo-alpha");
        writeRollbackSessionRecord(generatedWorktree, session);
        spawnSync("git", ["worktree", "add", "-q", manualWorktree, "-b", "feature/manual-beta"], {
          cwd: sandbox,
        });

        const generated = spawnSync(
          "bash",
          [SCRIPT_PATH, "stop", "--rollback", session, "alpha"],
          {
            cwd: sandbox,
            encoding: "utf-8",
            env: {
              PATH: process.env.PATH ?? "",
              LC_ALL: "C",
              LANG: "C",
              WORKTREE_PARENT_DIR: sandbox,
              WORKTREE_PREFIX: "proj-wt-",
            },
          },
        );
        expect(generated.status).toBe(0);
        const afterGenerated = spawnSync("git", ["branch", "--list"], {
          cwd: sandbox,
          encoding: "utf-8",
        });
        expect(afterGenerated.stdout).not.toMatch(/feature\/demo-alpha/);

        const manual = spawnSync(
          "bash",
          [SCRIPT_PATH, "stop", "--rollback", session, "beta"],
          {
            cwd: sandbox,
            encoding: "utf-8",
            env: {
              PATH: process.env.PATH ?? "",
              LC_ALL: "C",
              LANG: "C",
              WORKTREE_PARENT_DIR: sandbox,
              WORKTREE_PREFIX: "proj-wt-",
            },
          },
        );
        expect(manual.status).toBe(0);
        expect(manual.stderr).toMatch(/session record mismatch/i);
        expect(existsSync(manualWorktree)).toBe(true);
        const afterManual = spawnSync("git", ["branch", "--list"], {
          cwd: sandbox,
          encoding: "utf-8",
        });
        expect(afterManual.stdout).toMatch(/feature\/manual-beta/);
      } finally {
        spawnSync("git", ["worktree", "remove", generatedWorktree, "--force"], { cwd: sandbox });
        spawnSync("git", ["worktree", "remove", manualWorktree, "--force"], { cwd: sandbox });
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stop --rollback skips explicit slug worktrees with a mismatched session record",
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), "harness-rollback-explicit-"));
      const session = rollbackTestSession("explicit");
      const worktree = join(sandbox, "proj-wt-alpha");
      try {
        spawnSync("git", ["init", "-q"], { cwd: sandbox });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: sandbox });
        spawnSync("git", ["config", "user.name", "Harness Test"], { cwd: sandbox });
        writeFileSync(join(sandbox, "README.md"), "base\n");
        spawnSync("git", ["add", "README.md"], { cwd: sandbox });
        spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: sandbox });
        spawnSync("git", ["worktree", "add", "-q", worktree, "-b", "feature/demo-alpha"], {
          cwd: sandbox,
        });
        writeRollbackBranchRecord(worktree, "feature/demo-alpha");
        writeRollbackSessionRecord(worktree, rollbackTestSession("other"));

        const r = spawnSync("bash", [SCRIPT_PATH, "stop", "--rollback", session, "alpha"], {
          cwd: sandbox,
          encoding: "utf-8",
          env: {
            PATH: process.env.PATH ?? "",
            LC_ALL: "C",
            LANG: "C",
            WORKTREE_PARENT_DIR: sandbox,
            WORKTREE_PREFIX: "proj-wt-",
          },
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/session record mismatch/i);
        expect(existsSync(worktree)).toBe(true);
        const branches = spawnSync("git", ["branch", "--list"], {
          cwd: sandbox,
          encoding: "utf-8",
        });
        expect(branches.stdout).toMatch(/feature\/demo-alpha/);
      } finally {
        spawnSync("git", ["worktree", "remove", worktree, "--force"], { cwd: sandbox });
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stop --rollback falls back to git worktree list when tmux is gone and parent is relative",
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), "harness-rollback-fallback-"));
      const session = rollbackTestSession("fallback");
      const worktree = join(tmpdir(), `${basename(sandbox)}-wt-alpha`);
      const foreignWorktree = join(tmpdir(), `${basename(sandbox)}-wt-beta`);
      try {
        spawnSync("git", ["init", "-q"], { cwd: sandbox });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: sandbox });
        spawnSync("git", ["config", "user.name", "Harness Test"], { cwd: sandbox });
        writeFileSync(join(sandbox, "README.md"), "base\n");
        spawnSync("git", ["add", "README.md"], { cwd: sandbox });
        spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: sandbox });
        spawnSync("git", ["worktree", "add", "-q", worktree, "-b", "feature/main-alpha"], {
          cwd: sandbox,
        });
        writeRollbackBranchRecord(worktree, "feature/main-alpha");
        writeRollbackSessionRecord(worktree, session);
        spawnSync("git", ["worktree", "add", "-q", foreignWorktree, "-b", "feature/main-beta"], {
          cwd: sandbox,
        });
        writeRollbackBranchRecord(foreignWorktree, "feature/main-beta");
        writeRollbackSessionRecord(foreignWorktree, rollbackTestSession("other"));

        const r = spawnSync("bash", [SCRIPT_PATH, "stop", "--rollback", session], {
          cwd: sandbox,
          encoding: "utf-8",
          env: {
            PATH: process.env.PATH ?? "",
            LC_ALL: "C",
            LANG: "C",
          },
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/falling back to git worktree list/i);
        expect(r.stderr).toMatch(/session record mismatch/i);
        expect(existsSync(worktree)).toBe(false);
        expect(existsSync(foreignWorktree)).toBe(true);
        const branches = spawnSync("git", ["branch", "--list"], {
          cwd: sandbox,
          encoding: "utf-8",
        });
        expect(branches.stdout).not.toMatch(/feature\/main-alpha/);
        expect(branches.stdout).toMatch(/feature\/main-beta/);
      } finally {
        spawnSync("git", ["worktree", "remove", worktree, "--force"], { cwd: sandbox });
        spawnSync("git", ["worktree", "remove", foreignWorktree, "--force"], { cwd: sandbox });
        rmSync(worktree, { recursive: true, force: true });
        rmSync(foreignWorktree, { recursive: true, force: true });
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stop --rollback validates tmux-discovered window names before cleanup",
    () => {
      const binDir = mkdtempSync(join(tmpdir(), "harness-tmux-"));
      const parentDir = mkdtempSync(join(tmpdir(), "harness-tmux-parent-"));
      try {
        writeFileSync(
          join(binDir, "tmux"),
          [
            "#!/usr/bin/env bash",
            "if [[ \"$1\" == \"list-windows\" ]]; then",
            "  printf '%s\\n' coordinator alpha api.v2 'bad;rm'",
            "  exit 0",
            "fi",
            "exit 0",
            "",
          ].join("\n"),
          { mode: 0o755 },
        );

        const r = runScript(["stop", "--rollback", rollbackTestSession("tmux-slugs")], {
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          WORKTREE_PARENT_DIR: parentDir,
          WORKTREE_PREFIX: "tmux-wt-",
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/skip unsafe tmux window name 'api\.v2'/);
        expect(r.stderr).toMatch(/skip unsafe tmux window name 'bad;rm'/);
        expect(r.stderr).toMatch(/worktree .*tmux-wt-alpha.*missing.*skip/i);
        expect(r.stdout).toMatch(/slugs: alpha/);
        expect(r.stdout).not.toMatch(/api\.v2|bad;rm/);
      } finally {
        rmSync(binDir, { recursive: true, force: true });
        rmSync(parentDir, { recursive: true, force: true });
      }
    },
  );

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

  it("dry-run attach prints concise tmux operator help", () => {
    const r = runScript(["--dry-run", "attach", "frontend", "review_session"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/tmux quickref/i);
    expect(r.stderr).toMatch(/Ctrl-b d/i);
    expect(r.stderr).toMatch(/list-windows/i);
    expect(r.stderr).toMatch(/review_session/);
    expect(r.stderr).toMatch(/parallel-sessions-template\.sh attach 'frontend' 'review_session'/);
    expect(r.stderr).toMatch(/parallel-sessions-template\.sh verify 'review_session' 'frontend'/);
    expect(r.stderr).not.toMatch(/parallel-worktree-v2/);
    expect(r.stderr).not.toContain("docs/operator/tmux-quickref.md");
  });

  it("start failure paths roll back generated worktrees before exiting", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    expect(content).toMatch(/rollback_started_worktrees\(\)/);
    expect(content).toMatch(
      /if\s+!\s+record_generated_branch_for_cleanup\s+"\$wt"\s+"\$branch";\s+then[\s\S]{0,800}rollback_started_worktrees\s+"\$parent"\s+"\$prefix"\s+"\$\{spawned_slugs\[@\]\}"/,
    );
    expect(content).toMatch(
      /if\s+!\s+copy_handoff_sources_to_worktree\s+"\$wt";\s+then[\s\S]{0,800}rollback_started_worktrees\s+"\$parent"\s+"\$prefix"\s+"\$\{spawned_slugs\[@\]\}"/,
    );
    expect(content).toMatch(
      /if\s+!\s+install_plugins_for_worktree\s+"\$wt";\s+then[\s\S]{0,800}rollback_started_worktrees\s+"\$parent"\s+"\$prefix"\s+"\$\{spawned_slugs\[@\]\}"/,
    );
  });
});

describe("parallel-sessions-template.sh: dry-run idle pane labels", () => {
  it("dry-run label-panes prints tmux select-pane commands for idle labels", () => {
    const r = runScript([
      "--dry-run",
      "label-panes",
      "harness-parallel",
      "api=api-IDLE-12m",
      "frontend=frontend",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/tmux select-pane -t 'harness-parallel:api\.0' -T 'api-IDLE-12m'/);
    expect(r.stdout).toMatch(/tmux select-pane -t 'harness-parallel:frontend\.0' -T 'frontend'/);
    expect(r.stdout).not.toMatch(/rename-window/);
  });

  it("rejects unsafe label-panes titles before emitting any tmux command", () => {
    const r = runScript([
      "--dry-run",
      "label-panes",
      "harness-parallel",
      "api=api;rm",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pane title|invalid characters|Error/i);
    expect(r.stdout).not.toMatch(/select-pane|rename-window/);
  });

  it("rejects unsafe label-panes session names before emitting any tmux command", () => {
    const r = runScript([
      "--dry-run",
      "label-panes",
      "bad'; touch /tmp/owned; echo '",
      "api=api-IDLE-12m",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/tmux session name|invalid characters|Error/i);
    expect(r.stdout).not.toMatch(/select-pane|rename-window/);
  });
});
