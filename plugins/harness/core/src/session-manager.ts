/**
 * core/src/session-manager.ts
 *
 * Stage C: progress aggregator for parallel-worktree v2.
 *
 * Each per-worktree `claude -p --output-format stream-json` writes its
 * stream-json events to `<logDir>/claude-log-<slug>.jsonl`. This module:
 *
 *   1. Tails / reads those log files (`readSessionLog`).
 *   2. Detects Phase markers in assistant text (`detectPhaseMarker`).
 *   3. Cross-references each worktree's git log (`readGitCommits`).
 *   4. Builds a per-slug summary (`buildSessionSummary`).
 *   5. Renders a coordinator dashboard markdown table (`renderDashboard`).
 *
 * The companion skill `commands/claude-oneshot.md` writes those log files,
 * and `commands/parallel-worktree-v2.md` will fan out N invocations and
 * call `renderDashboard` to display orchestrator state.
 *
 * Implementation is intentionally synchronous and dependency-free so that
 * vitest can drive it from in-memory fixtures without polyfills.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface SessionEvent {
  slug: string;
  timestamp: string;
  type: "tool_use" | "phase_marker" | "commit" | "completion" | "error";
  payload: Record<string, unknown>;
}

export interface SessionSummary {
  slug: string;
  branch: string | null;
  phase: string | null;
  lastCommit:
    | { hash: string; message: string; relativeTime: string }
    | null;
  status:
    | "running"
    | "actionable=0"
    | "ship"
    | "merged"
    | "error"
    | "unknown";
  events: SessionEvent[];
}

const PHASE_MARKER_REGEX =
  /Phase\s*\d+(?:\.\d+)?\b[^\n]*?(?:GREEN|RED|REFACTOR|actionable|SHIP|FIX_FIRST|APPROVED|Real\s+CR|Pseudo\s+CR|merged)?/i;

export function detectPhaseMarker(text: string): string | null {
  if (!text) return null;
  const m = text.match(PHASE_MARKER_REGEX);
  if (!m) return null;
  return m[0];
}

interface AssistantBlock {
  type?: unknown;
  name?: unknown;
  input?: unknown;
  text?: unknown;
}

interface AssistantMessageShape {
  content?: AssistantBlock[];
}

interface RawStreamLine {
  type?: unknown;
  message?: AssistantMessageShape;
  timestamp?: unknown;
}

function parseAssistant(
  slug: string,
  obj: RawStreamLine,
  timestamp: string,
): SessionEvent | null {
  const blocks = obj.message?.content;
  if (!Array.isArray(blocks)) return null;
  // Early-return on first matching block: tool_use OR phase_marker.
  // This intentional simplification keeps parseAssistant pure and testable.
  // Aggregation across multiple SessionEvents is delegated to the caller
  // (e.g., buildSessionSummary via PROGRESS event sequence), not within a
  // single assistant message.
  for (const block of blocks) {
    if (block.type === "tool_use" && typeof block.name === "string") {
      return {
        slug,
        timestamp,
        type: "tool_use",
        payload: {
          tool: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        },
      };
    }
    if (block.type === "text" && typeof block.text === "string") {
      const phase = detectPhaseMarker(block.text);
      if (phase) {
        return {
          slug,
          timestamp,
          type: "phase_marker",
          payload: { phase, text: block.text },
        };
      }
    }
  }
  return null;
}

/**
 * Parse a single stream-json line into a SessionEvent.
 *
 * Expected line shape (Anthropic Claude Code stream-json output, per
 * `claude -p --output-format stream-json` documentation):
 *   { "type": "assistant", "message": { "content": [<block>...] }, "timestamp": "..." }
 *   { "type": "result" | "completion", ... }
 *
 * Recognised block shapes:
 *   tool_use:  { "type": "tool_use", "name": "<tool>", "input": {...} }
 *   text:      { "type": "text", "text": "..." }
 *
 * NOTE: This contract is **assumption-based** at module-write time
 * (2026-04-28) — modelled on the documented stream-json schema rather than
 * verified against a live `claude -p` capture. Unrecognised lines are
 * silently dropped (returns null), which is intentional for forward-compat
 * but means an undetected schema drift would manifest as a quiet downgrade
 * to "unknown" status. The Stage G end-to-end smoke test (when shipped) is
 * the supplementary detector for that drift.
 */
export function parseStreamJsonLine(
  slug: string,
  line: string,
): SessionEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: RawStreamLine;
  try {
    obj = JSON.parse(trimmed) as RawStreamLine;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const timestamp =
    typeof obj.timestamp === "string"
      ? obj.timestamp
      : new Date().toISOString();
  if (obj.type === "assistant") {
    return parseAssistant(slug, obj, timestamp);
  }
  if (obj.type === "result" || obj.type === "completion") {
    return {
      slug,
      timestamp,
      type: "completion",
      payload: { raw: obj as unknown as Record<string, unknown> },
    };
  }
  return null;
}

export function readSessionLog(
  slug: string,
  logDir?: string,
): SessionEvent[] {
  const dir =
    logDir ?? process.env.CLAUDE_ONESHOT_LOG_DIR ?? "/tmp";
  const path = join(dir, `claude-log-${slug}.jsonl`);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  const events: SessionEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    const ev = parseStreamJsonLine(slug, line);
    if (ev) events.push(ev);
  }
  return events;
}

export function readGitCommits(
  worktreePath: string,
  limit = 1,
): { hash: string; message: string; relativeTime: string }[] {
  if (!existsSync(worktreePath)) return [];
  const r = spawnSync(
    "git",
    ["log", `-${limit}`, "--format=%H%x09%s%x09%cr"],
    { cwd: worktreePath, encoding: "utf-8" },
  );
  if (r.status !== 0) return [];
  const out = (r.stdout ?? "").trim();
  if (!out) return [];
  // %s (subject) may rarely contain tab characters. Naive `split("\t")`
  // would silently truncate the message at the first inner tab and shift
  // relativeTime into the wrong slot. Use first-tab / last-tab anchors
  // to keep the middle (message) intact even with embedded tabs. %H (hash)
  // and %cr (relative time) are tab-free by Git's format guarantees.
  return out.split(/\r?\n/).flatMap((line) => {
    const firstTab = line.indexOf("\t");
    const lastTab = line.lastIndexOf("\t");
    if (firstTab < 0 || firstTab === lastTab) return [];
    return [
      {
        hash: line.slice(0, firstTab),
        message: line.slice(firstTab + 1, lastTab),
        relativeTime: line.slice(lastTab + 1),
      },
    ];
  });
}

function readGitBranch(worktreePath: string): string | null {
  if (!existsSync(worktreePath)) return null;
  const r = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: worktreePath, encoding: "utf-8" },
  );
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim();
  return out || null;
}

function inferStatus(
  events: SessionEvent[],
): SessionSummary["status"] {
  const phaseEvents = events.filter((e) => e.type === "phase_marker");
  if (phaseEvents.length === 0) {
    const hasToolUse = events.some((e) => e.type === "tool_use");
    return hasToolUse ? "running" : "unknown";
  }
  const last = phaseEvents[phaseEvents.length - 1]!;
  const payload = last.payload as { phase?: string; text?: string };
  const haystack = `${payload.text ?? ""} ${payload.phase ?? ""}`;
  if (/SHIP/i.test(haystack)) return "ship";
  if (/FIX_FIRST/i.test(haystack)) return "error";
  if (/actionable\s*=\s*0/i.test(haystack)) return "actionable=0";
  if (/APPROVED|merged/i.test(haystack)) return "merged";
  return "running";
}

export function buildSessionSummary(
  slug: string,
  opts: { logDir?: string; worktreePath?: string },
): SessionSummary {
  const events = readSessionLog(slug, opts.logDir);
  const commits = opts.worktreePath
    ? readGitCommits(opts.worktreePath, 1)
    : [];
  const branch = opts.worktreePath
    ? readGitBranch(opts.worktreePath)
    : null;

  const phaseEvents = events.filter((e) => e.type === "phase_marker");
  const lastPhase = phaseEvents.length
    ? (phaseEvents[phaseEvents.length - 1]!.payload as { phase: string })
        .phase
    : null;

  return {
    slug,
    branch,
    phase: lastPhase,
    lastCommit: commits[0] ?? null,
    status: inferStatus(events),
    events,
  };
}

// GFM table cells treat `|` as the column separator and `\n` as a row break.
// Even when a value is wrapped in backticks (inline code), some renderers
// still split on `|`, so we escape both unconditionally before interpolating
// commit messages / branch names / phase markers into the table.
function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderDashboard(summaries: SessionSummary[]): string {
  if (summaries.length === 0) {
    return "no sessions";
  }
  const header =
    "| slug | branch | phase | last commit | status |\n| --- | --- | --- | --- | --- |";
  const rows = summaries.map((s) => {
    const branch = s.branch ? escapeCell(s.branch) : "—";
    const phase = s.phase ? escapeCell(s.phase) : "—";
    const commit = s.lastCommit
      ? `${s.lastCommit.hash.slice(0, 7)} \`${escapeCell(s.lastCommit.message)}\` (${escapeCell(s.lastCommit.relativeTime)})`
      : "—";
    return `| ${escapeCell(s.slug)} | ${branch} | ${phase} | ${commit} | ${s.status} |`;
  });
  return [header, ...rows].join("\n");
}
