/**
 * index.test.ts
 * Integration tests for the `route()` dispatcher in `index.ts`.
 *
 * The dispatcher connects every hook handler to the public hook-result
 * protocol. Handlers produce a typed result with `additionalContext`. For
 * Anthropic 公式 modern hookSpecificOutput hooks (UserPromptSubmit /
 * PostToolUseFailure / ConfigChange / SubagentStart / SessionStart / Stop /
 * SubagentStop / PreCompact、Track A spec compliance により全 8 hook が
 * 同 branch に統合)、dispatcher は `HookResult.additionalContext` を wire
 * output `hookSpecificOutput.additionalContext` に lift し、
 * `decision: "approve"` sentinel を wire output から omit する (公式 spec で
 * `decision` field 自体非サポートまたは `"block"` のみ許容のため)。
 *
 * Harness-internal lifecycle hooks (task-created / task-completed /
 * worktree-remove 等、Anthropic 公式 hook 名でない harness 独自 event)
 * は dispatcher の legacy `JSON.stringify(result)` 経路で
 * `HookResult.reason` 経由のシリアライズを保つ (公式 spec の対象外、
 * internal sentinel として `decision: "approve"` 出力を許容)。
 *
 * These tests exercise the end-to-end flow per hook type, guarding against
 * regression of the additionalContext lift (modern branch) / reason mapping
 * (legacy branch) per hook category.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  route,
  errorToResult,
  sanitizeSafeFallbackReason,
  MAX_SAFE_FALLBACK_REASON_CHARS,
} from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function mkTmp(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("route() dispatcher — hook integration", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkTmp("harness-route-test");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("pre-compact", () => {
    // Hook spec audit (2026-04-28, Codex 一次資料): PreCompact は公式 spec で
    // `additionalContext` を top-level も `hookSpecificOutput.*` も
    // documented されない。spec-supported channel は universal `systemMessage`
    // のみ。dispatcher は handler の `additionalContext` を `systemMessage`
    // に routing して spec 準拠化する。
    it("routes handler.additionalContext to HookResult.systemMessage (spec-compliant universal field)", async () => {
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        cwd: tmpRoot,
        trigger: "auto",
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("=== Harness PreCompact");
      expect(result.systemMessage).toContain("[trigger] auto");
      // Regression guards: legacy fields must be silent for spec compliance.
      expect(result.reason).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
    });

    it("preserves `custom_instructions` at the highest-priority position", async () => {
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        cwd: tmpRoot,
        trigger: "manual",
        custom_instructions: "keep the assignment table verbatim",
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("[custom_instructions]");
      expect(result.systemMessage).toContain(
        "keep the assignment table verbatim",
      );

      // `custom_instructions` must appear BEFORE the `[trigger]` footer so
      // that compaction sees the user's retention instructions first.
      const customIdx = (result.systemMessage ?? "").indexOf(
        "[custom_instructions]",
      );
      const triggerIdx = (result.systemMessage ?? "").indexOf("[trigger]");
      expect(customIdx).toBeGreaterThan(-1);
      expect(triggerIdx).toBeGreaterThan(customIdx);
    });

    it("passes through session_id / cwd extraction from raw input without throwing", async () => {
      // Strings for session_id + cwd plus a non-string trigger should still
      // route cleanly; `extractString()` drops the bad field and the handler
      // falls back to "unknown".
      const result = await route("pre-compact", {
        hook_event_name: "PreCompact",
        session_id: "sess-123",
        cwd: tmpRoot,
        trigger: 42, // non-string — should be ignored by extractString()
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toContain("[trigger] unknown");
    });
  });

  describe("subagent-stop", () => {
    // Hook spec audit (2026-04-28, Codex 一次資料): SubagentStop は Stop と
    // 同 schema で `additionalContext` を top-level も `hookSpecificOutput.*`
    // も documented されない。spec-supported channel は universal
    // `systemMessage` のみ。dispatcher は `systemMessage` に routing する。
    it("non-worker agents: no systemMessage (handler returns no diagnostic)", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "reviewer",
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("worker agent with no detectable stack: routes 'no CI targets' message to systemMessage", async () => {
      // Empty tmp dir has no pyproject.toml / package.json, so
      // detectAvailableChecks() returns [].
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "worker",
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("CI チェック対象なし");
      // Regression guards: legacy / non-spec fields must stay empty.
      expect(result.reason).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
    });

    it("plugin-namespaced agent type 'harness:worker' is treated as worker", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "harness:worker",
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("CI チェック対象なし");
    });

    /**
     * dispatcher integration tests for `stop_hook_active`. Without these,
     * the SubagentStopInput field could be silently dropped at the
     * dispatcher boundary (e.g., a missing `extractBoolean` call) and unit
     * tests of `handleSubagentStop` alone would still pass while the
     * runtime guard never fires.
     */
    it("stop_hook_active=true via dispatcher → guard fires (no CI、no systemMessage)", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "worker",
        stop_hook_active: true,
      });
      expect(result.decision).toBe("approve");
      // Guard short-circuits before producing a CI summary; systemMessage
      // therefore stays unset.
      expect(result.systemMessage).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("stop_hook_active=false via dispatcher → normal CI path (systemMessage populated)", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "worker",
        stop_hook_active: false,
      });
      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toContain("CI チェック対象なし");
    });

    it("非 boolean な stop_hook_active は extractBoolean で undefined → guard 非発火 (defensive)", async () => {
      const result = await route("subagent-stop", {
        hook_event_name: "SubagentStop",
        cwd: tmpRoot,
        agent_type: "worker",
        // string は extractBoolean で reject される (`typeof !== "boolean"`)
        stop_hook_active: "true" as unknown as boolean,
      });
      expect(result.decision).toBe("approve");
      // guard 非発火 → 通常経路 (systemMessage に CI 結果が乗る)
      expect(result.systemMessage).toContain("CI チェック対象なし");
    });
  });

  describe("subagent-start", () => {
    it("default config → additionalContext に SubagentStart diagnostic が入る (NOT reason)", async () => {
      // SubagentStart は modern hook: hookSpecificOutput.additionalContext を使う
      // (subagent-stop は legacy pattern で reason にマップされる)。
      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("SubagentStart");
      expect(result.additionalContext).toContain("agent_type=harness:worker");
      // block 非対応 → reason は undefined (decision block 時のみ populate)
      expect(result.reason).toBeUndefined();
    });

    it("enabled: false → additionalContext undefined、reason も undefined", async () => {
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify({ subagentStart: { enabled: false } }),
      );

      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("agentTypeNotes match → additionalContext に note 含む", async () => {
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify({
          subagentStart: {
            agentTypeNotes: {
              "harness:worker": "TDD first (red → green → refactor).",
            },
          },
        }),
      );

      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: "harness:worker",
        agent_id: "agent-001",
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toContain(
        "TDD first (red → green → refactor).",
      );
    });

    it("非 string 入力 (agent_type = 42 等) も crash せず undefined 扱いで処理", async () => {
      // extractString() は non-string を drop → handler 側で "unknown" に fallback
      const result = await route("subagent-start", {
        hook_event_name: "SubagentStart",
        cwd: tmpRoot,
        agent_type: 42, // non-string — should be dropped by extractString
        agent_id: null, // non-string — should be dropped by extractString
      });

      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toContain("agent_type=unknown");
      expect(result.additionalContext).toContain("agent_id=unknown");
    });
  });

  describe("task-created", () => {
    it("maps '[TaskCreated]' additionalContext into reason", async () => {
      const result = await route("task-created", {
        hook_event_name: "TaskCreated",
        cwd: tmpRoot,
        task_id: "T42",
        task_subject: "demo task",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCreated]");
      expect(result.reason).toContain("demo task");
    });

    it("falls back to task_id when task_subject is missing", async () => {
      const result = await route("task-created", {
        hook_event_name: "TaskCreated",
        cwd: tmpRoot,
        task_id: "T99",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCreated]");
      expect(result.reason).toContain("T99");
    });
  });

  describe("task-completed", () => {
    it("maps '[TaskCompleted]' additionalContext into reason", async () => {
      const result = await route("task-completed", {
        hook_event_name: "TaskCompleted",
        cwd: tmpRoot,
        task_id: "T42",
        task_subject: "demo task",
        task_status: "completed",
      });

      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("[TaskCompleted]");
      expect(result.reason).toContain("demo task");
    });
  });

  describe("stop", () => {
    // Hook spec audit (2026-04-28, Codex 一次資料): Stop は公式 spec で
    // `additionalContext` を top-level も `hookSpecificOutput.*` も documented
    // されない。spec-supported channel は universal `systemMessage` のみ。
    // dispatcher は handler の `additionalContext` を `systemMessage` に
    // routing する。`result.reason` は `decision === "block"` 時のみ populate
    // されるため、approve sentinel での Stop hook では undefined。
    it("returns approve with no systemMessage when no harness.config.json exists", async () => {
      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("lifts qualityGates reminders to systemMessage when config enables them", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
            enforcePseudoCoderabbit: true,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("品質ゲート");
      expect(result.systemMessage).toContain("TDD 必須");
      expect(result.systemMessage).toContain("疑似 CodeRabbit 必須");
      expect(result.systemMessage).toContain("Codex セカンドオピニオン必須");
      // enforceRealCoderabbit=false → no "本物 CodeRabbit" entry.
      expect(result.systemMessage).not.toContain("本物 CodeRabbit 必須");
      // Regression guards: legacy / non-spec fields stay empty.
      expect(result.reason).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
    });

    it("returns no systemMessage when every qualityGate is explicitly disabled", async () => {
      // All four gates explicitly false — loadConfigSafe merges user values
      // over defaults, so setting the full set here is required to produce
      // an empty reminder list (unlike the earlier impl that read raw JSON
      // and counted missing keys as false).
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
            enforcePseudoCoderabbit: false,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: false,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeUndefined();
    });

    it("partial qualityGates override keeps default-enabled gates in the reminder (mergeConfig semantics)", async () => {
      // Flip enforceTddImplement to false; other three default to true.
      // Previously stop.ts read raw JSON and treated unset gates as false,
      // which silently disabled the three real defaults. The hook now
      // routes through loadConfigSafe() so default-true gates stay enabled
      // under partial user overrides.
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).not.toContain("TDD 必須");
      expect(result.systemMessage).toContain("疑似 CodeRabbit 必須");
      expect(result.systemMessage).toContain("本物 CodeRabbit 必須");
      expect(result.systemMessage).toContain("Codex セカンドオピニオン必須");
    });

    it("emits the harness-work essence reminder when enforceHarnessWorkEssence is true", async () => {
      // Opt-in flag adds a separate `[harness-work essence]` line alongside
      // the existing `[品質ゲート]` block, pointing back to docs/harness-
      // work-essence.md so consumers can read the long-form contract.
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: false,
            enforcePseudoCoderabbit: false,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: false,
            enforceHarnessWorkEssence: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.decision).toBe("approve");
      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("[harness-work essence]");
      expect(result.systemMessage).toContain("docs/harness-work-essence.md");
      expect(result.systemMessage).toContain("never give up");
      // `[品質ゲート]` block must be absent when every per-phase gate is
      // disabled — the essence reminder is orthogonal.
      expect(result.systemMessage).not.toContain("[品質ゲート]");
    });

    it("emits both blocks when phase gates and the essence flag are enabled together", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
            enforcePseudoCoderabbit: false,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: false,
            enforceHarnessWorkEssence: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("[品質ゲート] TDD 必須");
      expect(result.systemMessage).toContain("[harness-work essence]");
    });

    it("sanitizes systemMessage newlines to prevent section-boundary injection", async () => {
      // The systemMessage payload joins sections; if a future section text
      // gains an embedded LF/CR (e.g. from dynamic config), it could forge
      // fake section boundaries downstream. Lock the contract to "no raw
      // newlines — section separator is the literal two-character `\\n`".
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
            enforcePseudoCoderabbit: false,
            enforceRealCoderabbit: false,
            enforceCodexSecondOpinion: false,
            enforceHarnessWorkEssence: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain("[品質ゲート]");
      expect(result.systemMessage).toContain("[harness-work essence]");
      expect(result.systemMessage).not.toMatch(/\r/);
      expect(result.systemMessage).not.toMatch(/\n/);
      expect(result.systemMessage).toContain("\\n");
    });

    it("omits the essence reminder when enforceHarnessWorkEssence is left at its default", async () => {
      // Default-off: a project that does not mention the new flag should
      // not see the reminder, even with the other gates active.
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).not.toContain("[harness-work essence]");
    });

    /**
     * Anthropic Claude Code Stop hook spec
     * (https://code.claude.com/docs/en/hooks) で `stop_hook_active` boolean
     * が true のときは hook 再 fire を抑止する契約。SubagentStop と同一
     * semantics (公式 hooks spec で Stop hook payload も `stop_hook_active`
     * と `last_assistant_message` を receive と確認済)。subagent-stop
     * dispatcher で先行適用された `extractBoolean` propagate を Stop hook にも
     * 対称適用しないと handler 側 guard が runtime で発火しないため、
     * dispatcher boundary integration tests で固定する。
     */
    it("stop_hook_active=true via dispatcher → guard fires (config あっても reminder なし)", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
            enforceHarnessWorkEssence: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
        stop_hook_active: true,
      });
      expect(result.decision).toBe("approve");
      // guard 早期 return → systemMessage / additionalContext / reason 全て
      // undefined、config 評価より前。
      expect(result.systemMessage).toBeUndefined();
      expect(result.additionalContext).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("stop_hook_active=false via dispatcher → 通常経路 (gates 設定で reminder 発火)", async () => {
      const config = {
        work: {
          qualityGates: {
            enforceTddImplement: true,
          },
        },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
        stop_hook_active: false,
      });
      expect(result.decision).toBe("approve");
      // guard 非発火 → 通常経路で reminder (systemMessage に lift)
      expect(result.systemMessage).toContain("TDD 必須");
    });

    it("非 boolean な stop_hook_active は extractBoolean で undefined → guard 非発火 (defensive)", async () => {
      const config = {
        work: { qualityGates: { enforceTddImplement: true } },
      };
      writeFileSync(
        join(tmpRoot, "harness.config.json"),
        JSON.stringify(config),
      );

      const result = await route("stop", {
        hook_event_name: "Stop",
        cwd: tmpRoot,
        // string は extractBoolean (typeof !== "boolean") で undefined 化
        stop_hook_active: "true" as unknown as boolean,
      });
      expect(result.decision).toBe("approve");
      // guard 非発火 → 通常経路で reminder (systemMessage に lift)
      expect(result.systemMessage).toContain("TDD 必須");
    });
  });

  describe("session lifecycle", () => {
    it("session-start returns approve with no reason (legacy: empty input)", async () => {
      const result = await route("session-start", {});
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });

    it("session-start with source=startup returns bare approve (no hint)", async () => {
      const result = await route("session-start", {
        hook_event_name: "SessionStart",
        source: "startup",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("session-start with source=resume injects resume hint", async () => {
      const result = await route("session-start", {
        hook_event_name: "SessionStart",
        source: "resume",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("resume");
    });

    it("session-start with source=compact injects compaction hint", async () => {
      const result = await route("session-start", {
        hook_event_name: "SessionStart",
        source: "compact",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("compact");
    });

    it("session-end returns approve with no reason", async () => {
      const result = await route("session-end", {});
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    });
  });

  describe("worktree-remove (non-blocking observability)", () => {
    it("maps handler.additionalContext into HookResult.reason", async () => {
      const result = await route("worktree-remove", {
        hook_event_name: "WorktreeRemove",
        cwd: tmpRoot,
        worktree_path: "/tmp/sample-wt/slug",
      });
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("WorktreeRemove");
      expect(result.reason).toContain("/tmp/sample-wt/slug");
    });

    it("passes through agent_type / agent_id extraction from raw input", async () => {
      const result = await route("worktree-remove", {
        hook_event_name: "WorktreeRemove",
        cwd: tmpRoot,
        worktree_path: "/tmp/sample-wt/slug",
        agent_type: "harness:worker",
        agent_id: "agent-xyz123",
      });
      expect(result.reason).toContain("harness:worker");
      expect(result.reason).toContain("agent-xyz123");
    });
  });

  describe("worktree-create (blocking protocol)", () => {
    // production 実装: `git worktree add` を実行し worktreePath を返す。
    // tmpRoot は git repo ではないので handler は失敗を fail-open で返し
    // (decision=approve, worktreePath=undefined)、main() が exit 1 に変換する
    // (blocking semantics)。
    //
    // 実 git worktree add 経由の成功ケースは worktree-lifecycle.test.ts で
    // カバーされる。本テストは route() dispatcher が worktreePath を
    // HookResult 経由で適切に伝搬することの guard。
    it("tmpRoot (非 git) では fail-open: decision=approve, worktreePath=undefined", async () => {
      const result = await route("worktree-create", {
        hook_event_name: "WorktreeCreate",
        cwd: tmpRoot,
        name: "not-git-slug",
      });
      expect(result.decision).toBe("approve");
      // 失敗時は worktreePath 未設定 (index.ts main() で exit 1)
      expect(result.worktreePath).toBeUndefined();
      // reason に失敗理由 (git / worktree / not a ... のいずれかの文字列) を含む
      expect(result.reason ?? "").toMatch(/git|worktree|not a|name/i);
    });

    it("route() は handler の worktreePath を HookResult に伝搬する (blocking 成功経路)", async () => {
      // 成功経路の検証: tmpRoot を git init して initial commit を置く。
      // `-b main` は git >= 2.28 のみ対応のため、古い runner では `git init`
      // + `git branch -M main` に fallback する (try/catch で段階的 trial)。
      try {
        execFileSync("git", ["init", "-b", "main"], {
          cwd: tmpRoot,
          stdio: "pipe",
        });
      } catch {
        execFileSync("git", ["init"], { cwd: tmpRoot, stdio: "pipe" });
      }
      execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "user.name", "harness-test"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "commit.gpgsign", "false"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      writeFileSync(join(tmpRoot, "README.md"), "test\n", "utf-8");
      execFileSync("git", ["add", "README.md"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: tmpRoot,
        stdio: "pipe",
      });

      const result = await route("worktree-create", {
        hook_event_name: "WorktreeCreate",
        cwd: tmpRoot,
        name: "route-slug",
      });
      expect(result.decision).toBe("approve");
      expect(result.worktreePath).toBeDefined();
      // isAbsolute で OS 中立判定 (Windows 互換)。
      expect(isAbsolute(result.worktreePath!)).toBe(true);

      // 後始末: 作成された worktree を除去 (tempDirs cleanup で broken worktree 扱いを防止)。
      // shell injection 排除のため execFileSync + args array を使う。
      try {
        execFileSync(
          "git",
          ["worktree", "remove", result.worktreePath!, "--force"],
          { cwd: tmpRoot, stdio: "pipe" },
        );
      } catch {
        // ignore — afterEach が tmpRoot 自体を rm する
      }
    });
  });

  describe("unknown hook type (safety net)", () => {
    it("returns approve with diagnostic reason for unrecognised hookType", async () => {
      // Force-cast through `unknown` because the signature of `route()`
      // intentionally only accepts known HookType values, but the runtime
      // default branch is part of the public contract.
      const result = await route(
        "mystery-hook" as unknown as Parameters<typeof route>[0],
        {},
      );
      expect(result.decision).toBe("approve");
      expect(result.reason).toContain("Unknown hook type");
    });
  });
});

describe("errorToResult() — fail-safe contract", () => {
  // Guards the fail-open path that main() uses when route() or any
  // handler throws. A regression here would let an exception crash the
  // hook runner, which would in turn stall Claude Code sessions.

  it("returns decision=approve for any Error thrown by a handler", () => {
    const result = errorToResult(new Error("boom"));
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Core engine error (safe fallback)");
    expect(result.reason).toContain("boom");
  });

  it("stringifies non-Error throws (string / number / object) safely", () => {
    expect(errorToResult("string-throw").reason).toContain("string-throw");
    expect(errorToResult(42).reason).toContain("42");
    expect(errorToResult({ complex: "object" }).reason).toContain("[object Object]");
  });

  it("includes the class name of Error subclasses via their message", () => {
    class MyCustomError extends Error {
      constructor() {
        super("my custom message");
        this.name = "MyCustomError";
      }
    }
    const result = errorToResult(new MyCustomError());
    expect(result.reason).toContain("my custom message");
  });

  it("never returns a decision other than 'approve' (fail-open guarantee)", () => {
    // Simulate a variety of throwable shapes to confirm the invariant.
    const cases: unknown[] = [
      new Error(""),
      "",
      0,
      false,
      null,
      undefined,
      Symbol("x"),
    ];
    for (const err of cases) {
      const result = errorToResult(err);
      expect(result.decision).toBe("approve");
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });
});

describe("main() entrypoint fail-open (e2e child-process contract)", () => {
  // Exercise the real main() by spawning the built entrypoint as a child
  // process. This is the only way to cover the full readStdin -> parse
  // -> route -> JSON.stringify pipeline that shipped hook dispatchers
  // actually invoke; `route()` unit tests bypass all of that.
  const distPath = resolve(__dirname, "../../dist/index.js");
  const distExists = existsSync(distPath);
  const buildSkipReason = distExists
    ? null
    : "dist/index.js not built; skip e2e test (covered by CI `npm run build` step)";

  it.skipIf(!distExists)(
    "malformed stdin returns a JSON fallback (decision=approve) instead of crashing",
    () => {
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: "{not valid json}",
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBeTruthy();
      const parsed: unknown = JSON.parse(result.stdout.trim());
      expect(parsed).toMatchObject({ decision: "approve" });
      // Reason content is an internal detail, but it must be non-empty
      // and surface the failure class ("Core engine error").
      expect((parsed as { reason: string }).reason).toContain(
        "Core engine error",
      );
    },
  );

  it.skipIf(!distExists)(
    "valid stdin for an unknown hook type returns the 'Unknown hook type' diagnostic fallback",
    () => {
      // The dispatcher routes non-session hook types through `parseInput()`,
      // which requires `tool_name`. Provide a minimally valid hook input so
      // we exercise route()'s default branch rather than the parseInput
      // throw path.
      const result = spawnSync(
        process.execPath,
        [distPath, "never-registered"],
        {
          input: JSON.stringify({ tool_name: "Bash", tool_input: {} }),
          encoding: "utf-8",
          timeout: 5_000,
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as {
        decision: string;
        reason: string;
      };
      expect(parsed.decision).toBe("approve");
      expect(parsed.reason).toContain("Unknown hook type");
    },
  );

  it.skipIf(!distExists)(
    "session-start accepts empty stdin and returns spec-compliant wire output (decision omitted)",
    () => {
      // SessionStart は Anthropic 公式 hooks reference で `decision` field
      // 非サポート (公式 spec を根拠に確認済)。internal handler は
      // `decision: "approve"` を sentinel として返すが、dispatcher が wire
      // output から omit して spec 準拠の JSON を出力する。
      const result = spawnSync(process.execPath, [distPath, "session-start"], {
        input: "",
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      // wire output から decision field が omit されている (spec 準拠)
      expect(parsed["decision"]).toBeUndefined();
      // top-level additionalContext も出ない (lift 専用、shape regression 検知)
      expect(parsed["additionalContext"]).toBeUndefined();
      // empty input + no source → bare approve、hookSpecificOutput.additionalContext
      // も無い (handler が何も hint しない)
      expect(parsed["hookSpecificOutput"]).toBeUndefined();
    },
  );

  it.skipIf(!distExists)(
    "session-start with source=resume lifts additionalContext to hookSpecificOutput (spec-compliant)",
    () => {
      // resume hint の追加は wire output で `hookSpecificOutput.additionalContext`
      // に lift される (公式 spec 準拠)。top-level に出ない、`decision` も omit。
      const result = spawnSync(process.execPath, [distPath, "session-start"], {
        input: JSON.stringify({
          hook_event_name: "SessionStart",
          source: "resume",
        }),
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      // decision は wire output に出ない
      expect(parsed["decision"]).toBeUndefined();
      // top-level additionalContext は出ない (lift 専用、shape regression 検知)
      expect(parsed["additionalContext"]).toBeUndefined();
      // additionalContext は hookSpecificOutput.additionalContext に lift
      const hso = parsed["hookSpecificOutput"] as
        | Record<string, unknown>
        | undefined;
      expect(hso).toBeDefined();
      expect(hso?.["hookEventName"]).toBe("SessionStart");
      expect(typeof hso?.["additionalContext"]).toBe("string");
      expect(String(hso?.["additionalContext"])).toContain("resume");
    },
  );

  it.skipIf(!distExists)(
    "stop: empty config → spec-compliant wire output (decision omit、追加 context なし)",
    () => {
      // Track A spec compliance: Stop は公式 spec で `decision: "block"` のみ
      // 許容 + `additionalContext` top-level 非サポート。dispatcher は
      // hookSpecificOutput.additionalContext に lift し `decision: "approve"`
      // sentinel を wire output から omit する。harness.config.json 不在で
      // bare approve に落ちるケースで shape regression を固定する。
      const tmpRootEmpty = mkTmp("harness-stop-empty-e2e");
      try {
        const result = spawnSync(process.execPath, [distPath, "stop"], {
          input: JSON.stringify({
            hook_event_name: "Stop",
            cwd: tmpRootEmpty,
          }),
          encoding: "utf-8",
          timeout: 5_000,
        });
        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        // wire output から decision field が omit されている (spec 準拠)
        expect(parsed["decision"]).toBeUndefined();
        // top-level additionalContext は出ない (lift 専用、shape regression 検知)
        expect(parsed["additionalContext"]).toBeUndefined();
        // empty config → bare approve、hookSpecificOutput.additionalContext も
        // 不要 (handler が何も hint しない)
        expect(parsed["hookSpecificOutput"]).toBeUndefined();
      } finally {
        rmSync(tmpRootEmpty, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "stop: qualityGates configured → additionalContext routed to systemMessage (spec-compliant universal field)",
    () => {
      // Hook spec compliance audit (2026-04-28, Codex primary-source review):
      // Stop / SubagentStop / PreCompact do NOT support `additionalContext`
      // per the Anthropic spec (https://code.claude.com/docs/en/hooks) —
      // neither at top-level NOR inside `hookSpecificOutput`. The
      // spec-supported channel for "context delivered to Claude on next
      // turn" is the universal `systemMessage` field. Handler still
      // produces the quality-gate reminder text via `additionalContext`
      // for backward-compat semantics; dispatcher routes it into
      // `systemMessage` so the wire output stays spec-compliant.
      const tmpRootStop = mkTmp("harness-stop-e2e");
      try {
        writeFileSync(
          join(tmpRootStop, "harness.config.json"),
          JSON.stringify({
            work: {
              qualityGates: {
                enforceTddImplement: true,
                enforceHarnessWorkEssence: true,
              },
            },
          }),
        );
        const result = spawnSync(process.execPath, [distPath, "stop"], {
          input: JSON.stringify({
            hook_event_name: "Stop",
            cwd: tmpRootStop,
          }),
          encoding: "utf-8",
          timeout: 5_000,
        });
        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        // `decision: "approve"` is omitted from wire output (spec allows
        // only `block`; modern branch strips other values).
        expect(parsed["decision"]).toBeUndefined();
        // `additionalContext` (top-level) is not in spec for Stop event
        expect(parsed["additionalContext"]).toBeUndefined();
        // `hookSpecificOutput.additionalContext` is also not in spec for
        // Stop event — must NOT appear.
        expect(parsed["hookSpecificOutput"]).toBeUndefined();
        // Reminder text travels through the universal `systemMessage`
        // field (spec-supported for every hook event).
        expect(typeof parsed["systemMessage"]).toBe("string");
        expect(String(parsed["systemMessage"])).toContain("TDD 必須");
        expect(String(parsed["systemMessage"])).toContain(
          "[harness-work essence]",
        );
      } finally {
        rmSync(tmpRootStop, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "subagent-stop: worker agent_type → additionalContext routed to systemMessage (spec-compliant universal field)",
    () => {
      // SubagentStop inherits Stop's spec — neither additionalContext
      // top-level nor hookSpecificOutput.additionalContext is documented.
      // empty tmp dir → handler emits "no CI" notice in additionalContext;
      // dispatcher routes it to systemMessage for spec compliance.
      const tmpRootSubStop = mkTmp("harness-subagent-stop-e2e");
      try {
        const result = spawnSync(
          process.execPath,
          [distPath, "subagent-stop"],
          {
            input: JSON.stringify({
              hook_event_name: "SubagentStop",
              cwd: tmpRootSubStop,
              agent_type: "worker",
            }),
            encoding: "utf-8",
            timeout: 5_000,
          },
        );
        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        expect(parsed["decision"]).toBeUndefined();
        expect(parsed["additionalContext"]).toBeUndefined();
        expect(parsed["hookSpecificOutput"]).toBeUndefined();
        expect(typeof parsed["systemMessage"]).toBe("string");
        expect(String(parsed["systemMessage"])).toContain(
          "CI チェック対象なし",
        );
      } finally {
        rmSync(tmpRootSubStop, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "pre-compact: trigger=auto → additionalContext routed to systemMessage (spec-compliant universal field)",
    () => {
      // PreCompact: context-compaction observability hook. Spec only
      // documents `decision: "block"`; additionalContext is not part of
      // the schema (top-level nor hookSpecificOutput). Plans.md / branch /
      // open-PRs sections are routed via `systemMessage` so they survive
      // compaction as spec-supported context delivery.
      const tmpRootPreC = mkTmp("harness-pre-compact-e2e");
      try {
        const result = spawnSync(process.execPath, [distPath, "pre-compact"], {
          input: JSON.stringify({
            hook_event_name: "PreCompact",
            cwd: tmpRootPreC,
            trigger: "auto",
          }),
          encoding: "utf-8",
          timeout: 5_000,
        });
        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        expect(parsed["decision"]).toBeUndefined();
        expect(parsed["additionalContext"]).toBeUndefined();
        expect(parsed["hookSpecificOutput"]).toBeUndefined();
        expect(typeof parsed["systemMessage"]).toBe("string");
        expect(String(parsed["systemMessage"])).toContain(
          "=== Harness PreCompact",
        );
        expect(String(parsed["systemMessage"])).toContain("[trigger] auto");
      } finally {
        rmSync(tmpRootPreC, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "worktree-create: 成功時 stdout に raw absolute path、NOT JSON、exit 0",
    () => {
      // 公式仕様 (code.claude.com/docs/en/hooks):
      //   Command hook は worktreePath を raw stdout に書き出す (JSON ではなく生パス)
      //   exit 0 = 成功、worktree 作成成功
      // main() は worktree-create の HookResult.worktreePath を JSON 化せず
      // そのまま stdout に出す分岐を持つ必要がある。
      const gitRepo = mkTmp("harness-wtc-e2e");
      try {
        // git init -b main with fallback (git < 2.28 compatibility)
        try {
          execFileSync("git", ["init", "-b", "main"], {
            cwd: gitRepo,
            stdio: "pipe",
          });
        } catch {
          execFileSync("git", ["init"], { cwd: gitRepo, stdio: "pipe" });
        }
        execFileSync("git", ["config", "user.email", "e2e@example.com"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["config", "user.name", "e2e"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["config", "commit.gpgsign", "false"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        writeFileSync(join(gitRepo, "hello.txt"), "hi\n", "utf-8");
        execFileSync("git", ["add", "hello.txt"], {
          cwd: gitRepo,
          stdio: "pipe",
        });
        execFileSync("git", ["commit", "-m", "init"], {
          cwd: gitRepo,
          stdio: "pipe",
        });

        const result = spawnSync(
          process.execPath,
          [distPath, "worktree-create"],
          {
            input: JSON.stringify({
              hook_event_name: "WorktreeCreate",
              cwd: gitRepo,
              name: "e2e-slug",
            }),
            encoding: "utf-8",
            timeout: 15_000,
          },
        );
        expect(result.status).toBe(0);
        const stdout = result.stdout.trim();
        // Raw absolute path であり JSON ではない (isAbsolute で OS 中立判定)。
        expect(isAbsolute(stdout)).toBe(true);
        expect(stdout).not.toMatch(/^\{/);
        expect(existsSync(stdout)).toBe(true);

        // 生成 worktree の cleanup (shell injection 排除のため execFileSync + args array)
        try {
          execFileSync("git", ["worktree", "remove", stdout, "--force"], {
            cwd: gitRepo,
            stdio: "pipe",
          });
        } catch {
          // ignore
        }
      } finally {
        rmSync(gitRepo, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!distExists)(
    "worktree-create: 失敗時 exit 非 0 (blocking protocol — 公式: any non-zero exit causes creation to fail)",
    () => {
      // non-git dir → handler は worktreePath を返せない
      // → main() は exit 1 で blocking 失敗を通知
      const nonGit = mkTmp("harness-wtc-nogit-e2e");
      try {
        const result = spawnSync(
          process.execPath,
          [distPath, "worktree-create"],
          {
            input: JSON.stringify({
              hook_event_name: "WorktreeCreate",
              cwd: nonGit,
              name: "e2e-fail",
            }),
            encoding: "utf-8",
            timeout: 5_000,
          },
        );
        expect(result.status).not.toBe(0);
      } finally {
        rmSync(nonGit, { recursive: true, force: true });
      }
    },
  );

  if (buildSkipReason !== null) {
    // One marker test always runs so the reader of `vitest --reporter=verbose`
    // sees why the e2e suite is empty in local / dev runs.
    it("dist/index.js presence check", () => {
      // When this test passes with `distExists === false`, the actual
      // end-to-end tests above are skipped. Build once with `npm run build`
      // (or let CI do it) to see them.
      expect(buildSkipReason).toContain("not built");
    });
  }
});

describe("main() safe-fallback diagnostic surfacing", () => {
  // Guards against silent-exception serialization in the hookSpecificOutput
  // branch (user-prompt-submit / post-tool-use-failure / config-change /
  // subagent-start). Before the fix, a thrown handler + errorToResult() →
  // `decision: "approve"` produced an empty `{}` on stdout because the
  // reason string was only serialized under the `decision === "block"` path.
  // Critical diagnostics were hidden from the developer.
  //
  // Post-fix invariants (per Anthropic Claude Code hook spec,
  // https://code.claude.com/docs/en/hooks):
  //   1. exit code 0 (fail-open — the action must still proceed)
  //   2. stderr receives the reason (debug log + transcript first-line notice)
  //   3. stdout JSON carries `systemMessage` with the reason
  //      (top-level universal field — shown to user + delivered to Claude
  //       as context on the next conversation turn, per the spec)
  //   4. stdout JSON is NOT literally `{}`
  //
  // These tests intentionally spawn the built `dist/index.js` via child
  // process so the full readStdin → parse → route → serialize pipeline is
  // exercised end-to-end.
  const distPath = resolve(__dirname, "../../dist/index.js");
  const distExists = existsSync(distPath);

  // Malformed stdin forces `parseSessionInput()` → `JSON.parse()` to throw,
  // which is caught by main()'s catch block and routed through errorToResult().
  // This is the canonical way to exercise the fail-safe path from a child
  // process without monkey-patching imports.
  const MALFORMED_JSON = "{not valid json}";

  const MODERN_HOOK_TYPES = [
    "user-prompt-submit",
    "post-tool-use-failure",
    "config-change",
    "subagent-start",
    // Track A spec compliance: Anthropic spec 準拠で modern hookSpecificOutput
    // branch に合流した hook (Stop / SubagentStop / PreCompact)。これら 3 hook
    // でも silent {} drop / safe-fallback 経路の保証が必要なため、modern branch
    // の MODERN_HOOK_TYPES に追加して同 contract を共有する。
    "stop",
    "subagent-stop",
    "pre-compact",
  ] as const;

  for (const hookType of MODERN_HOOK_TYPES) {
    it.skipIf(!distExists)(
      `${hookType}: core engine error surfaces via stderr + systemMessage (no silent {} drop)`,
      () => {
        const result = spawnSync(process.execPath, [distPath, hookType], {
          input: MALFORMED_JSON,
          encoding: "utf-8",
          timeout: 5_000,
        });

        // 1. fail-open preserved — action proceeds
        expect(result.status).toBe(0);

        // 2. stderr carries the diagnostic (goes to debug log; non-zero exit
        //    would put first line in transcript — exit 0 + stderr is the
        //    Anthropic-recommended "keep stdout clean for JSON" pattern for
        //    fail-open surfaces)
        expect(result.stderr).toContain("Core engine error");

        // 3. stdout JSON is a non-empty object with systemMessage populated
        //    (NOT the pre-fix silent `{}`)
        const stdoutTrim = result.stdout.trim();
        expect(stdoutTrim).not.toBe("{}");
        const parsed = JSON.parse(stdoutTrim) as Record<string, unknown>;
        expect(typeof parsed["systemMessage"]).toBe("string");
        expect(parsed["systemMessage"] as string).toContain(
          "Core engine error",
        );
      },
    );
  }

  it.skipIf(!distExists)(
    "classic branch (pre-tool) regression: existing behaviour preserved — reason remains on stdout JSON",
    () => {
      // The classic output branch already includes reason via JSON.stringify(result).
      // The new safe-fallback stderr write must be additive, not disruptive.
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: MALFORMED_JSON,
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      expect(parsed["decision"]).toBe("approve");
      expect(parsed["reason"]).toContain("Core engine error");
      // Classic branch ALSO gets the new stderr surfacing for consistency.
      expect(result.stderr).toContain("Core engine error");
    },
  );

  it.skipIf(!distExists)(
    "safe-fallback reason sanitised: ANSI escape sequences + DEL + NUL stripped out of stderr / systemMessage",
    () => {
      // Claude Code hooks spec notes that `systemMessage` is delivered to
      // Claude as context on the next conversation turn — so a hostile or
      // accidentally noisy reason (ANSI colour codes, terminal-clear
      // escapes, raw NUL bytes) must be neutralised before it is surfaced
      // to the user OR to Claude. We stuff an embedded escape sequence +
      // NUL + DEL into stdin; `parseSessionInput` throws a SyntaxError
      // whose .message is echoed back into reason, but the sanitiser at
      // the boundary strips the bytes.
      //
      // Construct stdin with a literal escape (\x1B = ESC, 0x07 = BEL,
      // 0x00 = NUL, 0x7F = DEL). Node's JSON.parse will throw on the
      // binary bytes; the resulting error message from V8 incorporates
      // them into its diagnostic.
      const hostile = "\x1B[31m\x07\x00\x7F{";
      const result = spawnSync(
        process.execPath,
        [distPath, "user-prompt-submit"],
        {
          input: hostile,
          encoding: "utf-8",
          timeout: 5_000,
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      const systemMessage = parsed["systemMessage"] as string | undefined;
      expect(systemMessage).toBeDefined();
      // Neither stderr nor systemMessage may contain raw C0 / C1 / DEL
      // bytes. ESC (0x1B) / BEL (0x07) / NUL (0x00) / DEL (0x7F) must be
      // replaced with the safe placeholder `?`.
      expect(systemMessage!).not.toMatch(/[\x00\x07\x1B\x7F]/);
      expect(result.stderr).not.toMatch(/[\x00\x07\x1B\x7F]/);
      // But human-readable whitespace (LF / TAB) is preserved if present,
      // because stack traces need newlines to be readable. We assert that
      // the sanitiser did not clobber every byte — the diagnostic prefix
      // ("Core engine error") must remain.
      expect(systemMessage!).toContain("Core engine error");
    },
  );

  it.skipIf(!distExists)(
    "safe-fallback reason truncated when very long: systemMessage stays bounded to avoid context-window pressure",
    () => {
      // Unit-level guarantee: sanitizeSafeFallbackReason enforces the cap.
      // We exercise the in-process helper directly because constructing
      // a > 2000-char error message from malformed JSON is brittle across
      // Node versions.
      const huge = "x".repeat(MAX_SAFE_FALLBACK_REASON_CHARS + 500);
      const sanitised = sanitizeSafeFallbackReason(huge);
      expect(sanitised.length).toBeLessThanOrEqual(
        MAX_SAFE_FALLBACK_REASON_CHARS + "…[truncated]".length,
      );
      expect(sanitised).toContain("…[truncated]");
      // Short inputs must pass through unchanged (no false truncation).
      const short = "small diagnostic";
      expect(sanitizeSafeFallbackReason(short)).toBe(short);
    },
  );

  it("sanitizeSafeFallbackReason preserves human-readable whitespace (TAB / LF / CR)", () => {
    // Stack-trace style multi-line content must remain readable after
    // sanitisation. TAB / LF / CR are non-hostile formatting chars.
    const multiline = "line 1\n\tindented\r\nline 2";
    expect(sanitizeSafeFallbackReason(multiline)).toBe(multiline);
  });

  it("sanitizeSafeFallbackReason strips C1 control bytes (0x80-0x9F)", () => {
    // C1 controls are produced by 8-bit ANSI variants. Must be stripped
    // even though they are above 0x7F.
    const withC1 = "foo\x9Bbar\x9Fbaz";
    const sanitised = sanitizeSafeFallbackReason(withC1);
    expect(sanitised).toBe("foo?bar?baz");
  });

  it("sanitizeSafeFallbackReason truncates at Unicode code-point boundaries (no orphan surrogate)", () => {
    // Construct an input where a supplementary-plane char (😀 = U+1F600,
    // 2 UTF-16 code units) straddles the truncation cap. A naive
    // `stripped.slice(0, MAX)` would leave a lone high surrogate (\uD83D)
    // at the end — technically valid UTF-16 but invalid Unicode scalar
    // and rendered as garbage.
    //
    // Padding of exactly (MAX - 1) `x` followed by an emoji places the
    // emoji's high surrogate at index MAX - 1 and the low surrogate at
    // index MAX. `slice(0, MAX)` would therefore include the high
    // surrogate and drop the low one; the code-point-aware truncator
    // must drop the emoji entirely (keeping only the padding).
    const pad = "x".repeat(MAX_SAFE_FALLBACK_REASON_CHARS - 1);
    const withEmojiAtBoundary = pad + "😀" + "trailing";
    const sanitised = sanitizeSafeFallbackReason(withEmojiAtBoundary);

    // Must round-trip through JSON without producing invalid escapes.
    expect(() => JSON.parse(JSON.stringify(sanitised))).not.toThrow();
    // Must NOT end with a lone high surrogate (U+D800-U+DBFF).
    const lastChar = sanitised.slice(-"…[truncated]".length - 1).charCodeAt(0);
    expect(lastChar < 0xd800 || lastChar > 0xdbff).toBe(true);
    // The truncation marker must be present.
    expect(sanitised.endsWith("…[truncated]")).toBe(true);
  });

  it("sanitizeSafeFallbackReason preserves multi-byte content below the cap", () => {
    // Japanese / emoji input well under the cap must pass through
    // unmodified (no false truncation, no surrogate corruption).
    const mixed = "エラー: 😀 stack trace\n  at foo (a.ts:1:1)";
    expect(sanitizeSafeFallbackReason(mixed)).toBe(mixed);
  });

  it.skipIf(!distExists)(
    "worktree-create failure path: stderr emitted exactly once (no fail-safe double-write)",
    () => {
      // worktree-create has its own blocking-protocol failure branch
      // that writes `result.reason` to stderr on exit 1. The fail-safe
      // stderr write must skip this hook type so the diagnostic is
      // emitted exactly once — not twice.
      //
      // We trigger the fail-safe + worktree-create combination by
      // sending malformed JSON to the worktree-create entry point.
      // `parseSessionInput` throws, main() catches, `errorToResult()`
      // produces `{decision: "approve", reason: "Core engine error ..."}`
      // with no `worktreePath` set → worktree-create's own branch writes
      // reason to stderr + exits 1. If the fail-safe path ALSO writes,
      // stderr has two copies of the same message.
      const result = spawnSync(
        process.execPath,
        [distPath, "worktree-create"],
        {
          input: "{not valid json}",
          encoding: "utf-8",
          timeout: 5_000,
        },
      );
      // Blocking-protocol failure → exit non-zero
      expect(result.status).not.toBe(0);
      // The reason should appear in stderr exactly once — count
      // occurrences of the prefix "Core engine error" (every emission
      // carries it) and verify the count is 1, not 2+.
      const occurrences = result.stderr.split("Core engine error").length - 1;
      expect(occurrences).toBe(1);
    },
  );

  it.skipIf(!distExists)(
    "classic branch sanitisation: JSON.stringify(result).reason also scrubbed (not only stderr / systemMessage)",
    () => {
      // When the safe-fallback path fires, the sanitised reason is now
      // propagated back into `result.reason` so the classic output branch
      // (pre-tool / post-tool / permission / session / pre-compact / …)
      // also emits the scrubbed text inside its stdout JSON. Otherwise a
      // raw ANSI/NUL byte from an exception message could slip through
      // `JSON.stringify(result)` (where JSON.stringify would escape it as
      // `\uXXXX`, but a downstream display could still un-escape on render).
      //
      // We cannot easily inject control bytes via V8's JSON.parse error
      // path on every Node release, so we assert the weaker invariant
      // that the `reason` in stdout JSON equals the text on stderr —
      // both must be the single sanitised surface, not two divergent
      // strings.
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: "{not valid json}",
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      const stdoutReason = parsed["reason"] as string;
      const stderrTrim = result.stderr.trim();
      expect(stdoutReason).toBe(stderrTrim);
    },
  );

  it.skipIf(!distExists)(
    "handler-throws path (not JSON.parse) also routes through errorToResult + safe-fallback surfacing",
    () => {
      // Previously we only covered the stdin-JSON-parse exception path.
      // This test exercises the case where the handler itself throws
      // (e.g., a dynamic-import failure on a malformed hook). We trigger
      // this by feeding a session-hook-shaped JSON that lacks fields the
      // handler expects, then monkey-observes that the safe-fallback path
      // is still invoked end-to-end.
      //
      // Reality check: the modern handlers are defensive (they accept
      // unknown / missing fields gracefully), so a "pure" handler throw
      // is hard to force from stdin alone without monkey-patching. We
      // therefore use a different route: feed a hook type that ISN'T
      // recognised as a "session-shaped" hook (so it falls through to
      // the parseInput() branch) AND is on the modern list. Because
      // parseInput() requires `tool_name`, passing a minimal object
      // WITHOUT tool_name forces parseInput to throw — which is caught
      // by main() and routed through errorToResult. This is semantically
      // equivalent to a handler throw for our purposes: exception caught
      // by the outer try/catch → safeFallbackUsed=true → surfaced to
      // stderr + systemMessage.
      //
      // Note: we pick "pre-tool" here deliberately — for modern session
      // hooks, parseSessionInput does NOT require tool_name, so we can't
      // trigger the same failure mode. Classic-branch coverage is
      // sufficient to assert the contract, and the previous malformed-JSON
      // test already confirms the modern branch.
      const result = spawnSync(process.execPath, [distPath, "pre-tool"], {
        input: JSON.stringify({ no_tool_name_field: true }),
        encoding: "utf-8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      // parseInput throws ("Invalid hook input: missing required field
      // 'tool_name'"), which lands in errorToResult → safeFallback surface.
      expect(result.stderr).toContain("Core engine error");
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        unknown
      >;
      // Classic branch: reason is on the top-level JSON.
      expect(parsed["reason"]).toContain("Invalid hook input");
    },
  );

  it.skipIf(!distExists)(
    "modern hook happy path: no safe-fallback → no systemMessage injection (no regression on normal flows)",
    () => {
      // Normal invocation of subagent-start with valid input returns
      // additionalContext via hookSpecificOutput. systemMessage must NOT
      // be injected on the happy path — the lift is strictly safe-fallback
      // gated to avoid polluting every subagent spawn with a bogus warning.
      const tmpRootHappy = mkTmp("harness-happy-path");
      try {
        const result = spawnSync(
          process.execPath,
          [distPath, "subagent-start"],
          {
            input: JSON.stringify({
              hook_event_name: "SubagentStart",
              cwd: tmpRootHappy,
              agent_type: "harness:worker",
              agent_id: "agent-happy",
            }),
            encoding: "utf-8",
            timeout: 5_000,
          },
        );
        expect(result.status).toBe(0);
        // No stderr on happy path (no diagnostic to surface).
        expect(result.stderr).toBe("");
        const parsed = JSON.parse(result.stdout.trim()) as Record<
          string,
          unknown
        >;
        // Happy path must NOT carry systemMessage (that would leak a false
        // warning to the user on every subagent spawn).
        expect(parsed["systemMessage"]).toBeUndefined();
        // Existing invariant: hookSpecificOutput with additionalContext.
        expect(parsed["hookSpecificOutput"]).toBeDefined();
        const hso = parsed["hookSpecificOutput"] as Record<string, unknown>;
        expect(hso["hookEventName"]).toBe("SubagentStart");
        expect(hso["additionalContext"]).toBeDefined();
      } finally {
        rmSync(tmpRootHappy, { recursive: true, force: true });
      }
    },
  );
});
