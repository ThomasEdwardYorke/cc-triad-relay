/**
 * core/src/__tests__/cr-cache.test.ts
 *
 * Diff fingerprint cache for CodeRabbit / pseudo-CodeRabbit review results.
 * 同 commit hash (= 同 diff content + profile + .coderabbit.yaml) の重複 review を 100% skip。
 *
 * 設計不変条件 (本 test で守る):
 * - fingerprint は SHA-256 hex (64 char、deterministic)
 * - cache 保存先は `<workdir>/.coderabbit-cache/<fingerprint>.json`
 * - corrupt JSON は graceful degradation (null return、throw しない)
 * - path traversal 防止 (`../` を含む fingerprint は throw)
 * - invalidate は idempotent (cache dir 不在でも throw しない)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  computeFingerprint,
  lookupCache,
  writeCache,
  invalidateCache,
  CACHE_DIR_NAME,
} from "../cr-cache.js";

describe("cr-cache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cr-cache-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("computeFingerprint", () => {
    it("returns deterministic 64-char lowercase hex SHA-256 for identical input", () => {
      const input = {
        diff: "diff --git a/foo b/foo\n+changed",
        profile: "chill",
        coderabbitYaml: "reviews:\n  profile: chill\n",
        pathInstructionsHash: "abc123",
      };
      const fp1 = computeFingerprint(input);
      const fp2 = computeFingerprint(input);
      expect(fp1).toBe(fp2);
      expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("differs when diff differs", () => {
      const base = {
        profile: "chill",
        coderabbitYaml: "",
        pathInstructionsHash: "",
      };
      const fp1 = computeFingerprint({ ...base, diff: "diff a" });
      const fp2 = computeFingerprint({ ...base, diff: "diff b" });
      expect(fp1).not.toBe(fp2);
    });

    it("differs when profile differs", () => {
      const base = {
        diff: "same",
        coderabbitYaml: "",
        pathInstructionsHash: "",
      };
      const fp1 = computeFingerprint({ ...base, profile: "chill" });
      const fp2 = computeFingerprint({ ...base, profile: "assertive" });
      expect(fp1).not.toBe(fp2);
    });

    it("differs when .coderabbit.yaml content differs", () => {
      const base = {
        diff: "same",
        profile: "chill",
        pathInstructionsHash: "",
      };
      const fp1 = computeFingerprint({ ...base, coderabbitYaml: "y1" });
      const fp2 = computeFingerprint({ ...base, coderabbitYaml: "y2" });
      expect(fp1).not.toBe(fp2);
    });

    it("differs when pathInstructionsHash differs", () => {
      const base = {
        diff: "same",
        profile: "chill",
        coderabbitYaml: "",
      };
      const fp1 = computeFingerprint({ ...base, pathInstructionsHash: "h1" });
      const fp2 = computeFingerprint({ ...base, pathInstructionsHash: "h2" });
      expect(fp1).not.toBe(fp2);
    });

    it("guards against field collision (boundary delimiter)", () => {
      // diff=A profile=BC vs diff=AB profile=C should differ — naive concat
      // sha256(A + BC) == sha256(AB + C) なら collision、null delimiter で防ぐ
      const base = { coderabbitYaml: "", pathInstructionsHash: "" };
      const fp1 = computeFingerprint({ ...base, diff: "A", profile: "BC" });
      const fp2 = computeFingerprint({ ...base, diff: "AB", profile: "C" });
      expect(fp1).not.toBe(fp2);
    });

    it("guards against collision when fields contain whitespace (NUL byte delimiter)", () => {
      // space delimiter だと `"A B"` を含む input で trivial collision する:
      //   diff="A B" + profile="C"   = "A B C"
      //   diff="A"   + profile="B C" = "A B C"
      // NUL byte delimiter なら space を含む input でも区別される。
      const base = { coderabbitYaml: "", pathInstructionsHash: "" };
      const fp1 = computeFingerprint({ ...base, diff: "A B", profile: "C" });
      const fp2 = computeFingerprint({ ...base, diff: "A", profile: "B C" });
      expect(fp1).not.toBe(fp2);
    });

    it("guards against collision across multiple fields with shared whitespace", () => {
      // 3-field collision attempt: yaml に space を含めても破綻しない
      const fp1 = computeFingerprint({
        diff: "X",
        profile: "Y",
        coderabbitYaml: "Z W",
        pathInstructionsHash: "h",
      });
      const fp2 = computeFingerprint({
        diff: "X",
        profile: "Y Z",
        coderabbitYaml: "W",
        pathInstructionsHash: "h",
      });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("lookupCache + writeCache (round-trip)", () => {
    it("returns null when cache directory does not exist", () => {
      const fp = "0".repeat(64);
      expect(lookupCache(tmpDir, fp)).toBeNull();
    });

    it("returns null when cache entry does not exist", () => {
      const cacheDir = join(tmpDir, CACHE_DIR_NAME);
      mkdirSync(cacheDir, { recursive: true });
      const fp = "1".repeat(64);
      expect(lookupCache(tmpDir, fp)).toBeNull();
    });

    it("writes and reads back arbitrary JSON-serializable data", () => {
      const fp = "a".repeat(64);
      const findings = {
        actionable: [
          { file: "src/foo.ts", line: 42, severity: "major", msg: "fix me" },
        ],
        nitpick: [],
        cached_at: "2026-04-26T00:00:00Z",
      };
      writeCache(tmpDir, fp, findings);
      const result = lookupCache(tmpDir, fp);
      expect(result).toEqual(findings);
    });

    it("creates cache directory when absent (writeCache idempotent)", () => {
      const fp = "b".repeat(64);
      const cacheDir = join(tmpDir, CACHE_DIR_NAME);
      expect(existsSync(cacheDir)).toBe(false);
      writeCache(tmpDir, fp, { ok: true });
      expect(existsSync(cacheDir)).toBe(true);
      expect(lookupCache(tmpDir, fp)).toEqual({ ok: true });
    });

    it("overwrites existing entry on writeCache", () => {
      const fp = "c".repeat(64);
      writeCache(tmpDir, fp, { v: 1 });
      writeCache(tmpDir, fp, { v: 2 });
      expect(lookupCache(tmpDir, fp)).toEqual({ v: 2 });
    });

    it("returns null when cache file is corrupt JSON (graceful degradation)", () => {
      const fp = "d".repeat(64);
      const cacheDir = join(tmpDir, CACHE_DIR_NAME);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${fp}.json`), "{ invalid json", "utf-8");
      expect(lookupCache(tmpDir, fp)).toBeNull();
    });

    it("returns null when cache file is empty", () => {
      const fp = "e".repeat(64);
      const cacheDir = join(tmpDir, CACHE_DIR_NAME);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${fp}.json`), "", "utf-8");
      expect(lookupCache(tmpDir, fp)).toBeNull();
    });
  });

  describe("path traversal protection", () => {
    it("rejects fingerprint containing path separator", () => {
      expect(() => lookupCache(tmpDir, "../etc/passwd")).toThrow(
        /Invalid fingerprint/i,
      );
      expect(() => writeCache(tmpDir, "../malicious", { x: 1 })).toThrow(
        /Invalid fingerprint/i,
      );
      expect(() => invalidateCache(tmpDir, "../malicious")).toThrow(
        /Invalid fingerprint/i,
      );
    });

    it("rejects fingerprint with uppercase hex (must be lowercase)", () => {
      const upper = "A".repeat(64);
      expect(() => lookupCache(tmpDir, upper)).toThrow(/Invalid fingerprint/i);
    });

    it("rejects fingerprint with wrong length (not 64 chars)", () => {
      expect(() => lookupCache(tmpDir, "a".repeat(63))).toThrow(
        /Invalid fingerprint/i,
      );
      expect(() => lookupCache(tmpDir, "a".repeat(65))).toThrow(
        /Invalid fingerprint/i,
      );
      expect(() => lookupCache(tmpDir, "")).toThrow(/Invalid fingerprint/i);
    });

    it("rejects fingerprint with non-hex characters", () => {
      const bad = "g".repeat(64); // 'g' not in [0-9a-f]
      expect(() => lookupCache(tmpDir, bad)).toThrow(/Invalid fingerprint/i);
    });
  });

  describe("invalidateCache", () => {
    it("removes a single entry when fingerprint specified", () => {
      const fp1 = "f".repeat(64);
      const fp2 = "1".padEnd(64, "f");
      writeCache(tmpDir, fp1, { x: 1 });
      writeCache(tmpDir, fp2, { x: 2 });
      invalidateCache(tmpDir, fp1);
      expect(lookupCache(tmpDir, fp1)).toBeNull();
      expect(lookupCache(tmpDir, fp2)).toEqual({ x: 2 });
    });

    it("removes the whole cache directory when no fingerprint specified", () => {
      writeCache(tmpDir, "1".repeat(64), { x: 1 });
      writeCache(tmpDir, "2".repeat(64), { x: 2 });
      invalidateCache(tmpDir);
      const cacheDir = join(tmpDir, CACHE_DIR_NAME);
      expect(existsSync(cacheDir)).toBe(false);
    });

    it("is idempotent (no-op when cache dir is absent)", () => {
      expect(() => invalidateCache(tmpDir)).not.toThrow();
      expect(() => invalidateCache(tmpDir, "0".repeat(64))).not.toThrow();
    });

    it("is idempotent (no-op when entry is absent but cache dir exists)", () => {
      writeCache(tmpDir, "9".repeat(64), { x: 1 });
      expect(() => invalidateCache(tmpDir, "0".repeat(64))).not.toThrow();
      expect(lookupCache(tmpDir, "9".repeat(64))).toEqual({ x: 1 });
    });
  });

  describe("file format invariants", () => {
    it("stores cache as pretty-printed JSON (human-inspectable)", () => {
      const fp = "8".repeat(64);
      writeCache(tmpDir, fp, { foo: "bar", n: 42 });
      const filePath = resolve(tmpDir, CACHE_DIR_NAME, `${fp}.json`);
      const content = readFileSync(filePath, "utf-8");
      // pretty-printed = contains newline (not single-line JSON)
      expect(content).toContain("\n");
      expect(JSON.parse(content)).toEqual({ foo: "bar", n: 42 });
    });

    it("uses UTF-8 encoding (preserves non-ASCII characters)", () => {
      const fp = "7".repeat(64);
      const data = { msg: "日本語: 部品管理 🎯" };
      writeCache(tmpDir, fp, data);
      expect(lookupCache(tmpDir, fp)).toEqual(data);
    });
  });
});
