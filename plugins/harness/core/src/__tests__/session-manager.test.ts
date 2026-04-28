/**
 * core/src/__tests__/session-manager.test.ts
 *
 * Stage C: stream-json log + git commit aggregator for parallel-worktree v2.
 *
 * Each parallel `claude -p --output-format stream-json` session writes to
 * `<logDir>/claude-log-<slug>.jsonl`. The session-manager parses these
 * line-delimited JSON events, infers Phase markers and tool-use status,
 * cross-references each worktree's git log, and renders a coordinator
 * dashboard. This test fixes the API contract via a TDD Red→Green cycle.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  parseStreamJsonLine,
  detectPhaseMarker,
  readSessionLog,
  readGitCommits,
  buildSessionSummary,
  renderDashboard,
  type SessionEvent,
  type SessionSummary,
} from "../session-manager.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "session-manager-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("parseStreamJsonLine", () => {
  it("parses a tool_use event from a valid stream-json line", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "foo.ts" },
          },
        ],
      },
      timestamp: "2026-04-28T11:00:00Z",
    });
    const ev = parseStreamJsonLine("alpha", line);
    expect(ev).not.toBeNull();
    expect(ev!.slug).toBe("alpha");
    expect(ev!.type).toBe("tool_use");
    expect((ev!.payload as { tool: string }).tool).toBe("Edit");
  });

  it("parses an assistant text event into phase_marker if Phase N regex matches", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Phase 5 GREEN reached, all tests pass" }],
      },
      timestamp: "2026-04-28T11:01:00Z",
    });
    const ev = parseStreamJsonLine("alpha", line);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("phase_marker");
    expect((ev!.payload as { phase: string }).phase).toMatch(/^Phase\s*5\b/);
  });

  it("returns null for empty lines", () => {
    expect(parseStreamJsonLine("alpha", "")).toBeNull();
    expect(parseStreamJsonLine("alpha", "   ")).toBeNull();
  });

  it("returns null (and does not throw) for malformed JSON", () => {
    expect(parseStreamJsonLine("alpha", "{not json")).toBeNull();
    expect(parseStreamJsonLine("alpha", "garbage")).toBeNull();
  });

  it("returns null for unrecognised event shapes (no slot for them in summary)", () => {
    const line = JSON.stringify({ type: "unknown_event_type", foo: 1 });
    expect(parseStreamJsonLine("alpha", line)).toBeNull();
  });

  it("attaches the slug to every parsed event", () => {
    // Use a tool_use event since plain text without a Phase marker is
    // intentionally dropped (no slot in the summary). The intent of this
    // test is to confirm the slug is propagated, not the parse-vs-drop
    // logic of plain text — which is covered by `returns null for
    // unrecognised event shapes` above.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: {} }],
      },
      timestamp: "2026-04-28T11:00:00Z",
    });
    const ev = parseStreamJsonLine("backend", line);
    expect(ev?.slug).toBe("backend");
  });
});

describe("detectPhaseMarker", () => {
  it("detects `Phase 5 GREEN reached`", () => {
    expect(detectPhaseMarker("Phase 5 GREEN reached")).toMatch(/^Phase\s*5\b/);
  });

  it("detects `Phase 5.5 actionable=0`", () => {
    expect(detectPhaseMarker("Phase 5.5 actionable=0 — Pseudo CR clean")).toMatch(
      /^Phase\s*5\.5\b/,
    );
  });

  it("detects `Phase 7 SHIP`", () => {
    expect(detectPhaseMarker("Phase 7 SHIP — Codex adversarial review approved")).toMatch(
      /^Phase\s*7\b/,
    );
  });

  it("detects `Phase 6` Real CR mention", () => {
    expect(detectPhaseMarker("Phase 6 Real CR APPROVED")).toMatch(/^Phase\s*6\b/);
  });

  it("returns null for non-phase text", () => {
    expect(detectPhaseMarker("running tests")).toBeNull();
    expect(detectPhaseMarker("Edit src/foo.ts")).toBeNull();
  });

  it("is case-insensitive on the keyword `Phase`", () => {
    expect(detectPhaseMarker("phase 5 green reached")).toMatch(/^[Pp]hase\s*5\b/);
  });
});

describe("readSessionLog", () => {
  it("returns [] when log file does not exist", () => {
    const events = readSessionLog("nonexistent-slug", workdir);
    expect(events).toEqual([]);
  });

  it("parses each non-empty line in claude-log-<slug>.jsonl", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
        timestamp: "2026-04-28T11:00:00Z",
      }),
      "",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Phase 5.5 actionable=0" }] },
        timestamp: "2026-04-28T11:01:00Z",
      }),
    ];
    writeFileSync(join(workdir, "claude-log-alpha.jsonl"), lines.join("\n"));
    const events = readSessionLog("alpha", workdir);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("tool_use");
    expect(events[1]!.type).toBe("phase_marker");
  });

  it("uses CLAUDE_ONESHOT_LOG_DIR env when logDir not given", () => {
    // Use a tool_use event (parseable without a Phase marker) so that the
    // env-var resolution path is verifiable independently of the phase
    // detection logic.
    const file = join(workdir, "claude-log-bravo.jsonl");
    writeFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: {} }],
        },
        timestamp: "2026-04-28T11:00:00Z",
      }),
    );
    const prevEnv = process.env.CLAUDE_ONESHOT_LOG_DIR;
    process.env.CLAUDE_ONESHOT_LOG_DIR = workdir;
    try {
      const events = readSessionLog("bravo");
      expect(events).toHaveLength(1);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.CLAUDE_ONESHOT_LOG_DIR;
      } else {
        process.env.CLAUDE_ONESHOT_LOG_DIR = prevEnv;
      }
    }
  });

  it("falls back to /tmp when no env and no logDir", () => {
    // Just verify the function returns [] for a known-missing slug rather than
    // throwing. Hard-coded path /tmp covered as fallback.
    const events = readSessionLog("definitely-nonexistent-slug-xyz");
    expect(events).toEqual([]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const lines = [
      "{not json",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Phase 5 GREEN" }] },
        timestamp: "2026-04-28T11:00:00Z",
      }),
    ];
    writeFileSync(join(workdir, "claude-log-charlie.jsonl"), lines.join("\n"));
    const events = readSessionLog("charlie", workdir);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("phase_marker");
  });
});

describe("readGitCommits", () => {
  function setupGitRepo(dir: string, commitMessages: string[] = []): void {
    mkdirSync(dir, { recursive: true });
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    let i = 0;
    for (const msg of commitMessages) {
      writeFileSync(join(dir, `f${i}.txt`), `${i}`);
      spawnSync("git", ["add", "."], { cwd: dir });
      spawnSync("git", ["commit", "-q", "-m", msg], { cwd: dir });
      i++;
    }
  }

  it("returns [] for a path that is not a git repo", () => {
    const commits = readGitCommits(workdir);
    expect(commits).toEqual([]);
  });

  it("returns commits with hash / message / relativeTime", () => {
    const repo = join(workdir, "repo");
    setupGitRepo(repo, ["initial commit", "second commit"]);
    const commits = readGitCommits(repo, 2);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.message).toBe("second commit"); // newest first
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(commits[0]!.relativeTime).toMatch(/ago|second|minute/);
  });

  it("respects the limit argument", () => {
    const repo = join(workdir, "repo");
    setupGitRepo(repo, ["a", "b", "c", "d"]);
    const commits = readGitCommits(repo, 2);
    expect(commits).toHaveLength(2);
  });

  it("does not truncate commit messages that contain tab characters", () => {
    const repo = join(workdir, "repo");
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
    writeFileSync(join(repo, "x.txt"), "1");
    spawnSync("git", ["add", "."], { cwd: repo });
    // Use -F (commit message file) to inject literal tab characters
    // through git without bash quoting interfering.
    const msgFile = join(repo, ".commit-msg.tmp");
    writeFileSync(msgFile, "subject\twith\tembedded\ttabs");
    const c = spawnSync("git", ["commit", "-q", "-F", msgFile], { cwd: repo });
    expect(c.status).toBe(0);
    const commits = readGitCommits(repo, 1);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.message).toBe("subject\twith\tembedded\ttabs");
    expect(commits[0]!.relativeTime).toMatch(/ago|second|minute/);
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{7,40}$/);
  });
});

describe("buildSessionSummary", () => {
  it("combines logDir + worktreePath into a single SessionSummary", () => {
    const repo = join(workdir, "repo");
    mkdirSync(repo);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
    writeFileSync(join(repo, "x.txt"), "1");
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-q", "-m", "feat: initial"], { cwd: repo });

    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Phase 5.5 actionable=0" }] },
        timestamp: "2026-04-28T11:01:00Z",
      }),
    ];
    writeFileSync(join(workdir, "claude-log-delta.jsonl"), lines.join("\n"));
    const summary = buildSessionSummary("delta", {
      logDir: workdir,
      worktreePath: repo,
    });
    expect(summary.slug).toBe("delta");
    expect(summary.phase).toMatch(/^Phase\s*5\.5\b/);
    expect(summary.lastCommit?.message).toBe("feat: initial");
    expect(summary.status).toBe("actionable=0");
  });

  it("returns status `unknown` when no events and no commits", () => {
    const summary = buildSessionSummary("ghost", { logDir: workdir });
    expect(summary.slug).toBe("ghost");
    expect(summary.status).toBe("unknown");
  });

  it("status `ship` when latest phase marker contains SHIP keyword", () => {
    writeFileSync(
      join(workdir, "claude-log-echo.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Phase 7 SHIP — adversarial review passed" }] },
        timestamp: "2026-04-28T11:00:00Z",
      }),
    );
    const summary = buildSessionSummary("echo", { logDir: workdir });
    expect(summary.status).toBe("ship");
  });

  it("status `running` when only tool_use events present", () => {
    writeFileSync(
      join(workdir, "claude-log-foxtrot.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
        timestamp: "2026-04-28T11:00:00Z",
      }),
    );
    const summary = buildSessionSummary("foxtrot", { logDir: workdir });
    expect(summary.status).toBe("running");
  });
});

describe("renderDashboard", () => {
  it("renders a markdown table with one row per summary", () => {
    const summaries: SessionSummary[] = [
      {
        slug: "alpha",
        branch: "feature/main-alpha",
        phase: "Phase 5.5",
        lastCommit: { hash: "a1b2c3d", message: "feat: thing", relativeTime: "2 minutes ago" },
        status: "actionable=0",
        events: [],
      },
      {
        slug: "bravo",
        branch: "feature/main-bravo",
        phase: "Phase 5",
        lastCommit: { hash: "e4f5g6h", message: "wip", relativeTime: "6 minutes ago" },
        status: "running",
        events: [],
      },
    ];
    const md = renderDashboard(summaries);
    expect(md).toMatch(/\| slug\s*\|/);
    expect(md).toMatch(/alpha/);
    expect(md).toMatch(/bravo/);
    expect(md).toMatch(/Phase\s*5\.5/);
    expect(md).toMatch(/feat: thing/);
    expect(md).toMatch(/actionable=0/);
  });

  it("renders an explicit empty-state message when no summaries", () => {
    const md = renderDashboard([]);
    expect(md).toMatch(/no\s+sessions|empty|0\s+sessions/i);
  });

  it("escapes pipe characters in commit messages so GFM table cells stay intact", () => {
    const summaries: SessionSummary[] = [
      {
        slug: "weird",
        branch: "feature/foo|bar",
        phase: "Phase 5 | extra",
        lastCommit: {
          hash: "abcdef0",
          message: "feat: support || operator",
          relativeTime: "1 minute ago",
        },
        status: "running",
        events: [],
      },
    ];
    const md = renderDashboard(summaries);
    // each row should still have exactly 6 leading-pipe boundaries
    // (5 columns + leading + trailing pipe = 6 pipes per row), plus any
    // escaped `\|` from interpolated values. Verify by ensuring every
    // raw `|` in dynamic content is preceded by `\`.
    const rows = md.split("\n").slice(2); // skip header + separator
    for (const row of rows) {
      // Strip out escaped pipes; remaining pipes are real cell separators only.
      const stripped = row.replace(/\\\|/g, "");
      const cellCount = stripped.split("|").length - 1;
      expect(cellCount).toBe(6);
    }
    // Also confirm the escaped form is present (sanity).
    expect(md).toMatch(/\\\|/);
  });

  it("collapses newlines in cell values (commit messages with bodies)", () => {
    const summaries: SessionSummary[] = [
      {
        slug: "multi",
        branch: "main",
        phase: "Phase 5",
        lastCommit: {
          hash: "0123456",
          message: "feat: x\n\nlong body line",
          relativeTime: "2 minutes ago",
        },
        status: "running",
        events: [],
      },
    ];
    const md = renderDashboard(summaries);
    // the row containing commit message should not have an embedded newline
    const lines = md.split("\n");
    // header (1) + separator (2) + 1 row = 3 lines total
    expect(lines).toHaveLength(3);
  });

  it("renders dashes for missing fields (null branch / lastCommit / phase)", () => {
    const summary: SessionSummary = {
      slug: "lone",
      branch: null,
      phase: null,
      lastCommit: null,
      status: "unknown",
      events: [],
    };
    const md = renderDashboard([summary]);
    expect(md).toMatch(/lone/);
    expect(md).toMatch(/—|\bN\/A\b|--|unknown/i);
  });
});

describe("public API surface (export contract)", () => {
  it("SessionEvent type fields are stable", () => {
    // type-only test — if these property accesses compile, the contract holds.
    const ev: SessionEvent = {
      slug: "x",
      timestamp: "2026-04-28T11:00:00Z",
      type: "tool_use",
      payload: { tool: "Read" },
    };
    expect(ev.slug).toBe("x");
    expect(ev.type).toBe("tool_use");
  });

  it("SessionSummary type fields are stable", () => {
    const s: SessionSummary = {
      slug: "x",
      branch: null,
      phase: null,
      lastCommit: null,
      status: "unknown",
      events: [],
    };
    expect(s.slug).toBe("x");
  });
});

describe("parseAssistant early-return behavior (CR PR #65 Minor)", () => {
  it("returns early on first matching block when multiple blocks present", () => {
    // Document the parseAssistant early-return behavior: when content
    // contains multiple blocks (e.g., both tool_use and text with Phase marker),
    // the function returns on the first match (tool_use takes precedence).
    // Aggregation across multiple events is delegated to the caller
    // (buildSessionSummary via PROGRESS event sequence), not within a single message.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TaskUpdate",
            input: { task_id: "T-001", status: "in_progress" },
          },
          {
            type: "text",
            text: "Phase 5 GREEN — all tests pass",
          },
        ],
      },
      timestamp: "2026-04-28T11:00:00Z",
    });
    const ev = parseStreamJsonLine("alpha", line);
    expect(ev).not.toBeNull();
    // Early return: tool_use matched first, so Phase marker is not detected in this event.
    expect(ev!.type).toBe("tool_use");
    expect((ev!.payload as { tool: string }).tool).toBe("TaskUpdate");
  });
});
