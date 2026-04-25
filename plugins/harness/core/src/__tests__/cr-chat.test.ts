/**
 * core/src/__tests__/cr-chat.test.ts
 *
 * CodeRabbit chat command builder for operational commands that consume
 * the chat bucket (50/h on Pro plan) instead of the review bucket (5/h).
 *
 * Operational chat commands (chat bucket — *empirical verification needed*):
 *   - resolve       Mark all reviewable threads resolved
 *   - summary       Re-generate PR summary
 *   - configuration Print effective .coderabbit.yaml configuration
 *   - help          List available bot commands
 *
 * Review commands (review bucket — confirmed by official docs):
 *   - review        Incremental review trigger
 *   - full review   Force full review from scratch
 *
 * 不変条件 (本 test で守る):
 * - operational chat commands は review bucket を消費しない (Pro 50/h chat bucket)
 *   ※ 公式 docs 上 explicit bucket mapping は未公開。実装は assumption + caveat 明記
 * - review commands を operational として扱わない (過去の bug pattern)
 * - command body は `@coderabbitai <command>` で始まる (公式 docs syntax)
 */

import { describe, it, expect } from "vitest";
import {
  buildChatCommand,
  classifyBucket,
  CHAT_BUCKET_COMMANDS,
  REVIEW_BUCKET_COMMANDS,
} from "../cr-chat.js";

describe("cr-chat command builder", () => {
  describe("buildChatCommand", () => {
    it("constructs `@coderabbitai resolve` for resolve command", () => {
      expect(buildChatCommand("resolve")).toBe("@coderabbitai resolve");
    });

    it("constructs `@coderabbitai summary` for summary command", () => {
      expect(buildChatCommand("summary")).toBe("@coderabbitai summary");
    });

    it("constructs `@coderabbitai configuration` for configuration command", () => {
      expect(buildChatCommand("configuration")).toBe(
        "@coderabbitai configuration",
      );
    });

    it("constructs `@coderabbitai help` for help command", () => {
      expect(buildChatCommand("help")).toBe("@coderabbitai help");
    });

    it("supports optional message body appended on next line", () => {
      const out = buildChatCommand("resolve", "全 thread を解決済としてマーク");
      expect(out).toBe(
        "@coderabbitai resolve\n\n全 thread を解決済としてマーク",
      );
    });

    it("trims trailing whitespace from message body", () => {
      const out = buildChatCommand("summary", "  \n  body  \n  ");
      expect(out.endsWith("body")).toBe(true);
    });

    it("rejects unknown command (defensive)", () => {
      expect(() =>
        // @ts-expect-error intentional invalid input
        buildChatCommand("nonexistent"),
      ).toThrow(/unknown.*command/i);
    });

    it("rejects review-bucket commands (must use review trigger separately)", () => {
      expect(() =>
        // @ts-expect-error intentional misuse
        buildChatCommand("review"),
      ).toThrow(/review bucket|use trigger/i);
      expect(() =>
        // @ts-expect-error intentional misuse
        buildChatCommand("full review"),
      ).toThrow(/review bucket|use trigger/i);
    });
  });

  describe("classifyBucket", () => {
    it("classifies operational commands as 'chat'", () => {
      expect(classifyBucket("resolve")).toBe("chat");
      expect(classifyBucket("summary")).toBe("chat");
      expect(classifyBucket("configuration")).toBe("chat");
      expect(classifyBucket("help")).toBe("chat");
    });

    it("classifies review trigger commands as 'review'", () => {
      expect(classifyBucket("review")).toBe("review");
      expect(classifyBucket("full review")).toBe("review");
    });

    it("returns 'unknown' for unrecognized command", () => {
      expect(classifyBucket("foobar")).toBe("unknown");
    });
  });

  describe("CHAT_BUCKET_COMMANDS / REVIEW_BUCKET_COMMANDS exports", () => {
    it("CHAT_BUCKET_COMMANDS contains all 4 operational commands", () => {
      expect(CHAT_BUCKET_COMMANDS).toContain("resolve");
      expect(CHAT_BUCKET_COMMANDS).toContain("summary");
      expect(CHAT_BUCKET_COMMANDS).toContain("configuration");
      expect(CHAT_BUCKET_COMMANDS).toContain("help");
      expect(CHAT_BUCKET_COMMANDS).toHaveLength(4);
    });

    it("REVIEW_BUCKET_COMMANDS contains both review triggers", () => {
      expect(REVIEW_BUCKET_COMMANDS).toContain("review");
      expect(REVIEW_BUCKET_COMMANDS).toContain("full review");
      expect(REVIEW_BUCKET_COMMANDS).toHaveLength(2);
    });

    it("CHAT and REVIEW bucket sets are disjoint", () => {
      const chatSet = new Set(CHAT_BUCKET_COMMANDS);
      const reviewSet = new Set(REVIEW_BUCKET_COMMANDS);
      const intersection = [...chatSet].filter((c) =>
        reviewSet.has(c as never),
      );
      expect(intersection).toEqual([]);
    });
  });
});
