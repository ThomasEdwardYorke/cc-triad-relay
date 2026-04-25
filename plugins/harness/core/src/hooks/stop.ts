/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Reads project config via
 * `loadConfigWithError` so that partial `work.qualityGates` overrides
 * inherit the other gate defaults **and** so that a malformed config
 * file is not silently treated the same as a pristine config — a
 * broken file suppresses the reminders entirely (avoids the
 * silent-swallow failure mode where `loadConfigSafe` would emit every
 * default reminder even when the user never validly authored them).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigWithError } from "../config.js";

export interface StopInput {
  hook_event_name: string;
  session_id?: string | undefined;
  cwd?: string | undefined;
  stop_hook_active?: boolean | undefined;
}

export interface StopResult {
  decision: "approve";
  additionalContext?: string;
}

export async function handleStop(
  input: StopInput,
): Promise<StopResult> {
  const projectRoot = input.cwd ?? process.cwd();

  // Keep the historical behavior of returning a bare approve when the
  // project has no `harness.config.json` at all — we don't want to
  // start emitting reminders for projects that never opted in.
  const configPath = resolve(projectRoot, "harness.config.json");
  if (!existsSync(configPath)) {
    return { decision: "approve" };
  }

  const outcome = loadConfigWithError(projectRoot);
  if (outcome.error !== undefined) {
    // Malformed config. Emitting the default reminder set ("TDD 必須 /
    // 疑似 CodeRabbit 必須 / ...") would misrepresent the project's
    // intent — the user never successfully declared them. Surface the
    // parse failure to stderr and suppress all reminders for this turn.
    process.stderr.write(
      `[harness stop] harness.config.json parse failed: ${outcome.error}; suppressing quality-gate reminders until fixed.\n`,
    );
    return { decision: "approve" };
  }

  const gates = outcome.config.work.qualityGates;

  const reminders: string[] = [];
  if (gates.enforceTddImplement) {
    reminders.push("TDD 必須");
  }
  if (gates.enforcePseudoCoderabbit) {
    reminders.push("疑似 CodeRabbit 必須");
  }
  if (gates.enforceRealCoderabbit) {
    reminders.push("本物 CodeRabbit 必須");
  }
  if (gates.enforceCodexSecondOpinion) {
    reminders.push("Codex セカンドオピニオン必須");
  }

  // The phase-specific gates above mirror the four formal review phases.
  // The `harness-work-essence` gate is orthogonal and surfaces the
  // workflow-wide invariants (broad scope, structured Codex team, TDD
  // loop, never-give-up, no-leak-of-nitpicks, end-of-session handoff
  // archive/update). It ships as a separate `additionalContext` block so
  // the historical `[品質ゲート]` line stays unchanged for projects that
  // do not opt in.
  const sections: string[] = [];
  if (reminders.length > 0) {
    sections.push(`[品質ゲート] ${reminders.join(" / ")}`);
  }
  if (gates.enforceHarnessWorkEssence) {
    sections.push(
      "[harness-work essence] スコープ広く / 構造化チーム + Codex 並列 / TDD (Red→Green→Refactor) / 諦めない / 軽微指摘漏れなく対応 / 終了時 handoff archive+update — 詳細: docs/harness-work-essence.md",
    );
  }

  if (sections.length === 0) {
    return { decision: "approve" };
  }

  return {
    decision: "approve",
    additionalContext: sections.join("\n"),
  };
}
