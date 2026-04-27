/**
 * core/src/__tests__/_shared-sanitize.test.ts
 *
 * Shared sanitizer helper のテスト。
 *
 * `sanitizeAdditionalContextLine` は汎用 string sanitizer で、
 * `additionalContext` をはじめとする複数のフィールドで reuse される。
 * CR / LF / U+2028 / U+2029 を literal `\\n` に escape し、
 * section boundary smuggling を prevent する。
 */

import { describe, it, expect } from "vitest";
import { sanitizeAdditionalContextLine } from "../hooks/_shared/sanitize.js";

describe("_shared/sanitize.ts", () => {
  describe("sanitizeAdditionalContextLine — line terminator escape", () => {
    it("CRLF (\\r\\n) を literal \\n に escape する", () => {
      expect(sanitizeAdditionalContextLine("a\r\nb")).toBe("a\\nb");
    });

    it("LF (\\n) を literal \\n に escape する", () => {
      expect(sanitizeAdditionalContextLine("a\nb")).toBe("a\\nb");
    });

    it("CR (\\r) を literal \\n に escape する", () => {
      expect(sanitizeAdditionalContextLine("a\rb")).toBe("a\\nb");
    });

    it("U+2028 LINE SEPARATOR を literal \\n に escape する", () => {
      const input = "before after";
      expect(sanitizeAdditionalContextLine(input)).toBe("before\\nafter");
    });

    it("U+2029 PARAGRAPH SEPARATOR を literal \\n に escape する", () => {
      const input = "before after";
      expect(sanitizeAdditionalContextLine(input)).toBe("before\\nafter");
    });

    it("複数の line terminator が混在しても全て `\\n` に escape される", () => {
      const input = "a\nb\rc\r\nd e f";
      expect(sanitizeAdditionalContextLine(input)).toBe(
        "a\\nb\\nc\\nd\\ne\\nf",
      );
    });

    it("通常テキスト (line terminator なし) は変更されない", () => {
      const input = "plain text without any line breaks";
      expect(sanitizeAdditionalContextLine(input)).toBe(input);
    });

    it("複数の連続 LF は各々 `\\n` に escape される", () => {
      expect(sanitizeAdditionalContextLine("a\n\nb")).toBe("a\\n\\nb");
    });

    it("空文字列は変更されない", () => {
      expect(sanitizeAdditionalContextLine("")).toBe("");
    });

    it("スペース含むテキストは変更されない (\\s 非対象)", () => {
      expect(sanitizeAdditionalContextLine("a b c  d")).toBe("a b c  d");
    });
  });
});
