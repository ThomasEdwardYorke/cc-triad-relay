/**
 * core/src/__tests__/cr-cli.test.ts
 *
 * CodeRabbit CLI (`cr`) detector for harness Pseudo CR integration.
 *
 * Background:
 *   - `cr --agent --base <branch> --dir <path>` を直呼出する場合、
 *     binary が PATH にあり、かつ auth が valid (`cr auth status --agent`
 *     が `authenticated: true` を返す) ことを Pseudo CR loop 開始時に確認する
 *   - 不在 / unauth の場合は coderabbit-mimic agent (Codex 模倣) に fallback
 *   - CodeRabbit Pro plan の rate limit (5/h) は per developer seat、
 *     PR review と CLI review の bucket 独立性は公式 docs で **未確認**
 *     (Codex research 04-cli-auth-ci.md 参照、保守的に共有想定)
 *
 * Detection invariants (本 test で守る):
 *   - binary 不在は `{ available: false, reason: "binary-missing" }`
 *   - binary あるが auth 失敗は `{ available: false, reason: "unauthenticated" }`
 *   - binary + auth 成功は `{ available: true, version, authenticatedUser? }`
 *   - 例外 (`cr` の出力 parse 失敗) は throw せず `{ available: false, reason: "parse-error" }`
 *   - DI: spawn 関数を inject 可能にして実 binary 呼出を unit test で mock 化
 */

import { describe, it, expect } from "vitest";
import {
  detectCrCli,
  parseAuthStatusJson,
  parseVersionOutput,
  type CrSpawnResult,
} from "../cr-cli.js";

/**
 * Build a spawn fake that returns specific results for specific argv combos.
 * Each entry is `[matchPredicate, result]`.
 */
function spawnFake(
  cases: Array<[(argv: string[]) => boolean, CrSpawnResult]>,
): (argv: string[]) => CrSpawnResult {
  return (argv: string[]) => {
    for (const [match, result] of cases) {
      if (match(argv)) return result;
    }
    return { exitCode: 127, stdout: "", stderr: "command not found" };
  };
}

describe("cr-cli detector", () => {
  describe("detectCrCli — binary 不在", () => {
    it("returns { available: false, reason: 'binary-missing' } when which fails", () => {
      const spawn = spawnFake([
        [(argv) => argv[0] === "which", { exitCode: 1, stdout: "", stderr: "" }],
      ]);
      const result = detectCrCli({ spawn });
      expect(result).toEqual({
        available: false,
        reason: "binary-missing",
      });
    });

    it("returns binary-missing when which returns empty stdout", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "  \n", stderr: "" },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result.available).toBe(false);
      expect(result.reason).toBe("binary-missing");
    });
  });

  describe("detectCrCli — version 取得", () => {
    it("captures version when 'cr --version' returns SemVer-like string", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/usr/local/bin/cr\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "cr" && argv[1] === "--version",
          { exitCode: 0, stdout: "cr 0.5.2\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "cr" && argv[1] === "auth" && argv[2] === "status",
          {
            exitCode: 0,
            stdout: '{"type":"auth_status","authenticated":true,"user":"alice"}\n',
            stderr: "",
          },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result).toEqual({
        available: true,
        version: "0.5.2",
        authenticatedUser: "alice",
        binaryPath: "/usr/local/bin/cr",
      });
    });
  });

  describe("detectCrCli — auth 失敗", () => {
    it("returns unauthenticated when auth status JSON has authenticated=false", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/cr\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "cr" && argv[1] === "--version",
          { exitCode: 0, stdout: "cr 0.5.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "cr" && argv[1] === "auth" && argv[2] === "status",
          {
            exitCode: 0,
            stdout: '{"type":"auth_status","authenticated":false}\n',
            stderr: "",
          },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result.available).toBe(false);
      expect(result.reason).toBe("unauthenticated");
    });

    it("returns unauthenticated when auth status command exits non-zero", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/cr\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "cr" && argv[1] === "--version",
          { exitCode: 0, stdout: "cr 0.4.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "cr" && argv[1] === "auth" && argv[2] === "status",
          { exitCode: 1, stdout: "", stderr: "[error] Not authenticated" },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result.available).toBe(false);
      expect(result.reason).toBe("unauthenticated");
    });
  });

  describe("detectCrCli — symlink / canonical path 想定", () => {
    it("returns the binaryPath as reported by 'which' (caller decides on symlink resolve)", () => {
      // Codex review #4 への応答: 本 detector は `which` 出力をそのまま採用する。
      // symlink / PATH 改ざんへの対策は call site (例: caller が `realpath` で
      // canonical path を確認) の責務とする — detector を defensive layer に
      // しすぎると mock 化が難しくなり、unit test の再現性が下がるため。
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/local-cr-symlink/cr\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "cr" && argv[1] === "--version",
          { exitCode: 0, stdout: "cr 0.5.1\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "cr" && argv[1] === "auth" && argv[2] === "status",
          {
            exitCode: 0,
            stdout: '{"authenticated":true}\n',
            stderr: "",
          },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result).toMatchObject({
        available: true,
        binaryPath: "/opt/local-cr-symlink/cr",
      });
    });
  });

  describe("detectCrCli — parse-error fallback", () => {
    it("returns parse-error when auth status output is not valid JSON", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/cr\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "cr" && argv[1] === "--version",
          { exitCode: 0, stdout: "cr 0.5.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "cr" && argv[1] === "auth" && argv[2] === "status",
          { exitCode: 0, stdout: "garbage not json", stderr: "" },
        ],
      ]);
      const result = detectCrCli({ spawn });
      expect(result.available).toBe(false);
      expect(result.reason).toBe("parse-error");
    });

    it("does not throw when spawn itself throws (graceful)", () => {
      // detectCrCli を 1 回だけ呼び出し、`expect(...).not.toThrow()` の中で
      // 結果も取得する (二度呼びを避ける)。
      const spawn = (_argv: string[]): CrSpawnResult => {
        throw new Error("spawn ENOENT");
      };
      let result: ReturnType<typeof detectCrCli> | undefined;
      expect(() => {
        result = detectCrCli({ spawn });
      }).not.toThrow();
      expect(result?.available).toBe(false);
    });
  });

  describe("parseAuthStatusJson", () => {
    it("recognizes authenticated:true", () => {
      const result = parseAuthStatusJson(
        '{"type":"auth_status","authenticated":true,"user":"bob"}',
      );
      expect(result).toEqual({ authenticated: true, user: "bob" });
    });

    it("recognizes authenticated:false", () => {
      const result = parseAuthStatusJson('{"authenticated":false}');
      expect(result).toEqual({ authenticated: false });
    });

    it("returns null for invalid JSON", () => {
      expect(parseAuthStatusJson("not json")).toBeNull();
      expect(parseAuthStatusJson("")).toBeNull();
    });

    it("returns null when authenticated field is missing", () => {
      expect(parseAuthStatusJson('{"type":"other"}')).toBeNull();
    });

    it("ignores extra fields beyond authenticated/user", () => {
      const result = parseAuthStatusJson(
        '{"authenticated":true,"user":"x","extra":"y","plan":"pro"}',
      );
      expect(result?.authenticated).toBe(true);
      expect(result?.user).toBe("x");
    });
  });

  describe("parseVersionOutput", () => {
    it("extracts SemVer from 'cr X.Y.Z' format", () => {
      expect(parseVersionOutput("cr 0.5.2")).toBe("0.5.2");
      expect(parseVersionOutput("cr 1.0.0\n")).toBe("1.0.0");
    });

    it("extracts version with pre-release suffix", () => {
      expect(parseVersionOutput("cr 0.5.2-beta.1")).toBe("0.5.2-beta.1");
    });

    it("returns null when output has no version pattern", () => {
      expect(parseVersionOutput("not a version")).toBeNull();
      expect(parseVersionOutput("")).toBeNull();
    });
  });
});
