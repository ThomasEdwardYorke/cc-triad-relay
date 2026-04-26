/**
 * core/src/__tests__/cr-cli.test.ts
 *
 * CodeRabbit CLI (`coderabbit`) detector for harness Pseudo CR integration.
 *
 * Background:
 *   - `coderabbit --agent --base <branch> --dir <path>` を直呼出する場合、
 *     binary が PATH にあり、かつ auth が valid
 *     (`coderabbit auth status --agent` が `authenticated: true` を返す)
 *     ことを Pseudo CR loop 開始時に確認する
 *   - 不在 / unauth の場合は coderabbit-mimic agent (Codex 模倣) に fallback
 *   - 公式 install: `brew install --cask coderabbit` の binary 名は **`coderabbit`** (`cr` ではない、
 *     よくある誤解)。本 test は binary 名 regression guard を含む
 *   - CodeRabbit Pro plan の rate limit (5/h) は per developer seat、
 *     PR review と CLI review の bucket 独立性は公式 docs で **未確認**
 *     (Codex research 04-cli-auth-ci.md 参照、保守的に共有想定)
 *
 * Detection invariants (本 test で守る):
 *   - binary 不在は `{ available: false, reason: "binary-missing" }`
 *   - binary あるが auth 失敗は `{ available: false, reason: "unauthenticated" }`
 *   - binary + auth 成功は `{ available: true, version, authenticatedUser? }`
 *   - 例外 (`coderabbit` の出力 parse 失敗) は throw せず `{ available: false, reason: "parse-error" }`
 *   - binary 名は必ず `coderabbit` (`cr` ではない、regression guard あり)
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
    it("captures version when 'coderabbit --version' returns SemVer-like string", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/homebrew/bin/coderabbit\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "coderabbit" && argv[1] === "--version",
          { exitCode: 0, stdout: "0.5.2\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "coderabbit" &&
            argv[1] === "auth" &&
            argv[2] === "status",
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
        binaryPath: "/opt/homebrew/bin/coderabbit",
      });
    });
  });

  describe("detectCrCli — auth 失敗", () => {
    it("returns unauthenticated when auth status JSON has authenticated=false", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/coderabbit\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "coderabbit" && argv[1] === "--version",
          { exitCode: 0, stdout: "0.5.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "coderabbit" &&
            argv[1] === "auth" &&
            argv[2] === "status",
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
          { exitCode: 0, stdout: "/opt/coderabbit\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "coderabbit" && argv[1] === "--version",
          { exitCode: 0, stdout: "0.4.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "coderabbit" &&
            argv[1] === "auth" &&
            argv[2] === "status",
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
          {
            exitCode: 0,
            stdout: "/opt/local-coderabbit-symlink/coderabbit\n",
            stderr: "",
          },
        ],
        [
          (argv) => argv[0] === "coderabbit" && argv[1] === "--version",
          { exitCode: 0, stdout: "0.5.1\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "coderabbit" &&
            argv[1] === "auth" &&
            argv[2] === "status",
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
        binaryPath: "/opt/local-coderabbit-symlink/coderabbit",
      });
    });
  });

  describe("detectCrCli — parse-error fallback", () => {
    it("returns parse-error when auth status output is not valid JSON", () => {
      const spawn = spawnFake([
        [
          (argv) => argv[0] === "which",
          { exitCode: 0, stdout: "/opt/coderabbit\n", stderr: "" },
        ],
        [
          (argv) => argv[0] === "coderabbit" && argv[1] === "--version",
          { exitCode: 0, stdout: "0.5.0\n", stderr: "" },
        ],
        [
          (argv) =>
            argv[0] === "coderabbit" &&
            argv[1] === "auth" &&
            argv[2] === "status",
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
    it("extracts SemVer from 'coderabbit X.Y.Z' format", () => {
      expect(parseVersionOutput("coderabbit 0.5.2")).toBe("0.5.2");
      expect(parseVersionOutput("0.4.3")).toBe("0.4.3");
      expect(parseVersionOutput("1.0.0\n")).toBe("1.0.0");
    });

    it("extracts version with pre-release suffix", () => {
      expect(parseVersionOutput("coderabbit 0.5.2-beta.1")).toBe(
        "0.5.2-beta.1",
      );
    });

    it("returns null when output has no version pattern", () => {
      expect(parseVersionOutput("not a version")).toBeNull();
      expect(parseVersionOutput("")).toBeNull();
    });

    // 旧実装は `cr` を spawn していたため、homebrew install 環境
    // (`brew install --cask coderabbit` で binary 名 `coderabbit`) では
    // 常に `binary-missing` を返してしまっていた。本 regression guard は
    // version output の prefix が変わっても抽出できることを保証する。
    it("ignores prefix token (cr / coderabbit / v)", () => {
      expect(parseVersionOutput("v0.5.2")).toBe("0.5.2");
      expect(parseVersionOutput("cr 0.5.2")).toBe("0.5.2");
      expect(parseVersionOutput("coderabbit 0.5.2")).toBe("0.5.2");
    });
  });

  // Binary 名が `coderabbit` (homebrew install 名) であることを spawn argv
  // レベルで assertion する regression guard。誰かが将来 `cr` に戻したら
  // この test が即座に fail する。
  describe("detectCrCli — binary name regression guard (coderabbit, not cr)", () => {
    it("invokes 'which coderabbit' (not 'which cr')", () => {
      const observedArgv: string[][] = [];
      const spawn = (argv: string[]): CrSpawnResult => {
        observedArgv.push([...argv]);
        if (argv[0] === "which" && argv[1] === "coderabbit") {
          return {
            exitCode: 0,
            stdout: "/opt/homebrew/bin/coderabbit\n",
            stderr: "",
          };
        }
        if (argv[0] === "coderabbit" && argv[1] === "--version") {
          return { exitCode: 0, stdout: "0.4.3\n", stderr: "" };
        }
        if (argv[0] === "coderabbit" && argv[1] === "auth") {
          return {
            exitCode: 0,
            stdout: '{"authenticated":true,"user":"tester"}\n',
            stderr: "",
          };
        }
        return { exitCode: 127, stdout: "", stderr: "command not found" };
      };
      const result = detectCrCli({ spawn });
      expect(result.available).toBe(true);
      // 1st invocation must be `which coderabbit`
      expect(observedArgv[0]).toEqual(["which", "coderabbit"]);
      // No invocation should target the legacy `cr` binary name
      const legacyCalls = observedArgv.filter((argv) => argv[0] === "cr");
      expect(legacyCalls).toEqual([]);
    });

    it("invokes 'coderabbit --version' / 'coderabbit auth status --agent' as subsequent commands", () => {
      const observedArgv: string[][] = [];
      const spawn = (argv: string[]): CrSpawnResult => {
        observedArgv.push([...argv]);
        if (argv[0] === "which") {
          return {
            exitCode: 0,
            stdout: "/opt/homebrew/bin/coderabbit\n",
            stderr: "",
          };
        }
        if (argv[0] === "coderabbit" && argv[1] === "--version") {
          return { exitCode: 0, stdout: "0.4.3\n", stderr: "" };
        }
        if (argv[0] === "coderabbit" && argv[1] === "auth") {
          return {
            exitCode: 0,
            stdout: '{"authenticated":true}\n',
            stderr: "",
          };
        }
        return { exitCode: 127, stdout: "", stderr: "command not found" };
      };
      detectCrCli({ spawn });
      // 2nd: version check, 3rd: auth status
      expect(observedArgv[1]).toEqual(["coderabbit", "--version"]);
      expect(observedArgv[2]).toEqual([
        "coderabbit",
        "auth",
        "status",
        "--agent",
      ]);
    });
  });
});
