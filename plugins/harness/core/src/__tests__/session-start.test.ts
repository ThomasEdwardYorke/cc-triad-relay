/**
 * core/src/__tests__/session-start.test.ts
 *
 * SessionStart hook handler のテスト。
 *
 * Anthropic Claude Code SessionStart spec
 * (https://code.claude.com/docs/en/hooks) で規定された `source` フィールド
 * (`startup` / `resume` / `clear` / `compact`) に応じた挙動を検証する:
 *
 * - `startup`  : ピュアな新規 session、追加 context なし (legacy 互換)
 * - `resume`   : 中断 session の再開、resume 認識 hint を additionalContext で injection
 * - `clear`    : `/clear` 実行直後、clean slate (追加 context なし)
 * - `compact`  : compaction 直後の resume、PreCompact が積んだ context の補足を hint
 *
 * 設計原則:
 * - source 不在 / 不明値 / 非文字列はすべて legacy bare approve に fallback
 *   (forward-compatible: 将来 Anthropic が新 source を追加しても hook が壊れない)
 * - additionalContext は raw 改行を含まない (stop.ts パターン踏襲、
 *   下流 LLM への section boundary smuggle 防止)
 */

import { describe, it, expect } from "vitest";
import { handleSessionStart } from "../hooks/session-start.js";

describe("handleSessionStart", () => {
  describe("source field handling (Anthropic Claude Code SessionStart spec)", () => {
    it("source=startup は bare approve を返す (新規 session、追加 context 不要)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "startup",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("source=resume は resume 認識 hint を additionalContext に含める", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "resume",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("resume");
    });

    it("source=clear は bare approve を返す (clean slate、追加 context なし)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "clear",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("source=compact は post-compaction hint を additionalContext に含める (PreCompact 協調)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "compact",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).toContain("compact");
    });
  });

  describe("backwards compatibility / defensive parsing", () => {
    it("source 不在は legacy bare approve に fallback", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("不明な source 値は bare approve に fallback (forward-compatible)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "unexpected-future-value",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("非文字列 source は bare approve に fallback (defensive)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        // @ts-expect-error: 意図的に不正な型を渡して defensive 動作を検証
        source: 42,
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });

    it("空文字 source は bare approve に fallback (定義無効値)", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "",
      });
      expect(result.decision).toBe("approve");
      expect(result.additionalContext).toBeUndefined();
    });
  });

  describe("additionalContext sanitization (stop.ts と同じ smuggling guard)", () => {
    it("source=resume の additionalContext は raw 改行を含まない", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "resume",
      });
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).not.toMatch(/[\r\n]/);
    });

    it("source=compact の additionalContext は raw 改行を含まない", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "compact",
      });
      expect(result.additionalContext).toBeDefined();
      expect(result.additionalContext).not.toMatch(/[\r\n]/);
    });
  });

  describe("optional cwd / session_id pass-through (forward-compatible)", () => {
    it("cwd / session_id を渡しても例外を投げず approve を返す", async () => {
      const result = await handleSessionStart({
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: "/tmp/some-project",
        session_id: "sess-abc",
      });
      expect(result.decision).toBe("approve");
    });
  });
});
