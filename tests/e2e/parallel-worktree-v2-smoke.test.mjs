#!/usr/bin/env node
/**
 * tests/e2e/parallel-worktree-v2-smoke.test.mjs
 *
 * Phase 2 Stage G — End-to-end smoke for the Model B parallel-worktree
 * orchestrator. Wires real tmux + real git worktrees + a mock claude binary
 * (fixtures/mock-claude.sh) and asserts that:
 *
 *   1. parallel-sessions-template.sh `start` creates N tmux windows + N git
 *      worktrees + N independent mock-claude processes.
 *   2. Each mock-claude streams 9 stream-json events (8 assistant +
 *      1 result) to `<logDir>/claude-log-<slug>.jsonl`.
 *   3. session-manager.buildSessionSummary picks up phase markers + tool_use
 *      events and infers status === "ship" for every slug before the polling
 *      deadline.
 *
 * Skipped automatically when:
 *   - RUN_E2E !== "1" (default off; opt-in via CI job env)
 *   - process.platform === "win32" (tmux not viable on native Windows)
 *   - tmux is not on PATH (minimal CI image)
 *   - bash is not on PATH (Windows-without-WSL escape hatch)
 *
 * Skip == exit 0 (CI green); failure == exit 1 with diagnostic context.
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const fixturesDir = resolve(__dirname, "fixtures");
const mockClaude = join(fixturesDir, "mock-claude.sh");
const launcher = resolve(
  repoRoot,
  "plugins",
  "harness",
  "scripts",
  "parallel-sessions-template.sh",
);
const distSm = resolve(
  repoRoot,
  "plugins",
  "harness",
  "core",
  "dist",
  "session-manager.js",
);

// ─── skip gating ────────────────────────────────────────────────────────────

function skip(reason) {
  process.stdout.write(`SKIP parallel-worktree-v2 smoke: ${reason}\n`);
  process.exit(0);
}

if (process.env.RUN_E2E !== "1") skip("RUN_E2E !== '1'");
if (process.platform === "win32") skip("native Windows: tmux not viable");

const whichTmux = spawnSync("which", ["tmux"], { encoding: "utf-8" });
if (whichTmux.status !== 0) skip("tmux not on PATH");

const whichBash = spawnSync("which", ["bash"], { encoding: "utf-8" });
if (whichBash.status !== 0) skip("bash not on PATH");

// ─── sandbox + cleanup helpers (must be initialized before pre-flight) ─────
//
// The pre-flight artefact checks call `fail()`, and `fail()` calls
// `runCleanup()`, which dereferences `cleanups`, `cleanedUp`, and
// `sandbox`. If those bindings are still in the temporal dead zone when
// pre-flight fires, the resulting ReferenceError eclipses the real
// "launcher script missing" / "session-manager.js still missing" message
// and the test runner reports a misleading failure. Initialise the
// sandbox and cleanup machinery first so any subsequent fail() call gets
// surfaced verbatim with a tidy cleanup tail.

const runId = `${process.pid}-${Date.now().toString(36)}`;
const sandbox = mkdtempSync(join(tmpdir(), `harness-stage-g-${runId}-`));
const fakeRepo = join(sandbox, "repo");
const worktreeParent = join(sandbox, "wt-parent");
const logDir = join(sandbox, "logs");
const sessionName = `harness-e2e-${runId}`;
const slugs = ["alpha", "beta"];
const featureBranch = "stagegfeat";

const cleanups = [];
let cleanedUp = false;
function runCleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const fn of cleanups.reverse()) {
    try {
      fn();
    } catch (err) {
      process.stderr.write(`cleanup error (ignored): ${err}\n`);
    }
  }
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* ignored */
  }
}
process.on("SIGINT", () => {
  runCleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  runCleanup();
  process.exit(143);
});

function fail(msg) {
  process.stderr.write(`FAIL parallel-worktree-v2 smoke: ${msg}\n`);
  runCleanup();
  process.exit(1);
}

// ─── pre-flight: artefacts must exist ──────────────────────────────────────

if (!existsSync(launcher)) {
  fail(`launcher script missing: ${launcher}`);
}
if (!existsSync(mockClaude)) {
  fail(`mock claude fixture missing: ${mockClaude}`);
}
if (!existsSync(distSm)) {
  // build is a prerequisite (CI runs `npm run build` before smoke); be
  // forgiving for dev convenience.
  process.stdout.write(
    "session-manager.js missing under core/dist; running `npm run build`...\n",
  );
  const build = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: "inherit",
  });
  if (build.status !== 0) fail(`npm run build failed (status ${build.status})`);
  if (!existsSync(distSm)) fail(`session-manager.js still missing after build`);
}

// mock-claude must be executable; some checkouts strip the +x bit.
chmodSync(mockClaude, 0o755);

// ─── main flow ─────────────────────────────────────────────────────────────

main().catch((err) => fail(`uncaught: ${err?.stack ?? err}`));

async function main() {
  mkdirSync(fakeRepo, { recursive: true });
  mkdirSync(worktreeParent, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  // git init + initial commit on the feature branch the launcher will fork
  for (const cmd of [
    ["git", "init", "-q"],
    ["git", "config", "user.email", "stage-g@test.local"],
    ["git", "config", "user.name", "stage-g"],
    ["git", "checkout", "-q", "-b", featureBranch],
    ["git", "commit", "-q", "--allow-empty", "-m", "stage-g: initial"],
  ]) {
    const r = spawnSync(cmd[0], cmd.slice(1), {
      cwd: fakeRepo,
      encoding: "utf-8",
    });
    if (r.status !== 0) {
      fail(`git ${cmd.slice(1).join(" ")} failed: ${r.stderr}`);
    }
  }

  // Always tear down any tmux session we created, even on failure.
  cleanups.push(() => {
    spawnSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
  });

  // ─── launch ─────────────────────────────────────────────────────────────
  // Inherit the runner's PATH/HOME/etc but unset TMUX so the launcher's
  // `tmux new-session -d` always creates a fresh server with our `-e KEY=VAL`
  // forwards intact. If TMUX is set (developer running tests inside an
  // existing tmux), the new-session call would attach to that server and the
  // env passing test contract becomes unobservable.
  const env = {
    ...process.env,
    TMUX_SESSION_NAME: sessionName,
    WORKTREE_PARENT_DIR: worktreeParent,
    WORKTREE_PREFIX: "wt-",
    CLAUDE_BIN: mockClaude,
    CLAUDE_ONESHOT_LOG_DIR: logDir,
    CLAUDE_PERMISSION_MODE: "acceptEdits",
    // mock-claude.sh は events 出力後即 exit するため REPL prompt を持たず、
    // `/help` プローブにも応答できない. cmd_start 内の skill-registry verify
    // を opt-out して mock fixture と互換を維持する.
    // 実 claude 経路では default ON で動作する (CLAUDE_OVERLAY_LOAD_VERIFY 未設定).
    CLAUDE_OVERLAY_LOAD_VERIFY: "0",
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  // Prevent caller-shell leak: if the developer happens to have
  // TMUX_PASS_ENV set in their interactive session, the launcher would
  // forward whatever extra env vars they listed and the smoke's `-e KEY=`
  // assertions would no longer correspond to a deterministic, isolated
  // contract. Strip it so the test sees only the keys we explicitly
  // construct above.
  delete env.TMUX_PASS_ENV;

  // 30s hard timeout so a hung tmux server (e.g. a pre-existing socket
  // the runner cannot kill) cannot block the suite indefinitely; the
  // launcher itself is meant to return within ~1s for the dry-run plan
  // and ~5-10s when actually creating two worktrees.
  const launchRes = spawnSync(
    "bash",
    [launcher, "start", featureBranch, ...slugs],
    { cwd: fakeRepo, env, encoding: "utf-8", timeout: 30_000 },
  );
  if (launchRes.error || launchRes.signal || launchRes.status !== 0) {
    fail(
      `launcher failed: ` +
        `status=${launchRes.status}, signal=${launchRes.signal ?? "none"}, ` +
        `error=${launchRes.error?.message ?? "none"}\n` +
        `stdout:\n${launchRes.stdout ?? ""}\n` +
        `stderr:\n${launchRes.stderr ?? ""}`,
    );
  }

  // ─── load session-manager dynamically (post-build) ──────────────────────
  const sm = await import(distSm);
  if (typeof sm.buildSessionSummary !== "function") {
    fail("session-manager.js does not export buildSessionSummary");
  }

  // ─── poll until every slug reports completion or deadline elapses ───────
  const expectedTerminal = new Set(["ship", "merged"]);
  const deadline = Date.now() + 60_000;
  const pollIntervalMs = 500;

  let lastSummaries = null;
  while (Date.now() < deadline) {
    lastSummaries = slugs.map((slug) =>
      sm.buildSessionSummary(slug, {
        logDir,
        worktreePath: join(worktreeParent, `wt-${slug}`),
      }),
    );
    if (lastSummaries.every((s) => expectedTerminal.has(s.status))) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  // ─── assertions ─────────────────────────────────────────────────────────
  if (
    !lastSummaries ||
    !lastSummaries.every((s) => expectedTerminal.has(s.status))
  ) {
    const got =
      lastSummaries
        ?.map((s) => `${s.slug}=${s.status} (events:${s.events.length})`)
        .join(", ") ?? "null";
    fail(
      `polling deadline (60s) reached before all slugs hit {ship, merged}; got: ${got}`,
    );
  }

  for (const s of lastSummaries) {
    // mock-claude emits 9 events (8 assistant + 1 result); allow up to 2
    // lost to file-flush race (tmux pane lifetime can clip the final
    // writes on very slow CI runners).
    if (s.events.length < 7) {
      fail(
        `${s.slug}: expected >=7 events (9 emitted, race tolerance 2), got ${s.events.length}`,
      );
    }
    const phaseMarkers = s.events.filter((e) => e.type === "phase_marker");
    if (phaseMarkers.length === 0) {
      fail(`${s.slug}: no phase_marker events parsed`);
    }
    const toolUses = s.events.filter((e) => e.type === "tool_use");
    if (toolUses.length === 0) {
      fail(`${s.slug}: no tool_use events parsed`);
    }
    if (s.branch !== `feature/${featureBranch}-${s.slug}`) {
      fail(
        `${s.slug}: branch mismatch — expected feature/${featureBranch}-${s.slug}, got ${s.branch}`,
      );
    }
  }

  process.stdout.write("PASS parallel-worktree-v2 smoke\n");
  for (const s of lastSummaries) {
    process.stdout.write(
      `  ${s.slug}: status=${s.status} events=${s.events.length} branch=${s.branch} phase=${s.phase ?? "-"}\n`,
    );
  }
  runCleanup();
  process.exit(0);
}
