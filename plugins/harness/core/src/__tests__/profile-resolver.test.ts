/**
 * core/src/__tests__/profile-resolver.test.ts
 *
 * Pseudo / Real CodeRabbit profile resolver の precedence chain を網羅するテスト。
 *
 * Resolver の責務:
 *   - cliFlag > env > harnessConfigProfile > yamlProfile > default(chill) の precedence で確定
 *   - 各 source の invalid 値は警告 (warnings[]) を蓄積し、次の source に fallthrough
 *   - source 識別子を返却 (UI / log で「どこから profile を採用したか」を可視化)
 *
 * 背景:
 *   現行 `/pseudo-coderabbit-loop` は CLI flag と `.coderabbit.yaml` のみ参照し、
 *   `harness.config.json.tddEnforce.pseudoCoderabbitProfile` (validated 済) と
 *   env `HARNESS_CR_PROFILE` を読まない。本 resolver は両 source を chain に
 *   組み込み、全 entry point で同一 precedence を保証する pure function。
 */

import { describe, it, expect } from "vitest";
import {
  resolveProfile,
  VALID_PROFILES,
  type CoderabbitProfile,
  type ProfileResolution,
} from "../work/profile-resolver.js";

describe("resolveProfile — precedence chain", () => {
  describe("default fallback", () => {
    it("全 source 不在で chill を返す + source=default", () => {
      const r = resolveProfile({});
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("default");
      expect(r.warnings).toEqual([]);
    });
  });

  describe("cliFlag (priority 1, highest)", () => {
    it("cliFlag=chill を採用 + source=cli", () => {
      const r = resolveProfile({ cliFlag: "chill" });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("cli");
    });

    it("cliFlag=assertive を採用", () => {
      const r = resolveProfile({ cliFlag: "assertive" });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("cli");
    });

    it("cliFlag=strict (harness-local extension) を allowStrict default 時は許可", () => {
      const r = resolveProfile({ cliFlag: "strict" });
      expect(r.profile).toBe("strict");
      expect(r.source).toBe("cli");
    });

    it("cliFlag が他 source より優先される (cliFlag > env > config > yaml)", () => {
      const r = resolveProfile({
        cliFlag: "assertive",
        env: "chill",
        harnessConfigProfile: "strict",
        yamlProfile: "chill",
      });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("cli");
    });

    it("cliFlag invalid 値は警告 + 次 source へ fallthrough", () => {
      const r = resolveProfile({ cliFlag: "loose", env: "assertive" });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("env");
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.warnings[0]).toMatch(/cli.*invalid|invalid.*cli/i);
      expect(r.warnings[0]).toMatch(/loose/);
    });

    it("cliFlag=undefined / 空文字は無視 (警告なし)", () => {
      expect(resolveProfile({ cliFlag: undefined, env: "chill" }).warnings).toEqual([]);
      expect(resolveProfile({ cliFlag: "", env: "chill" }).warnings).toEqual([]);
    });

    it("allowStrict=false で cliFlag=strict は警告 + 次 source へ", () => {
      const r = resolveProfile({ cliFlag: "strict", env: "chill", allowStrict: false });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("env");
      expect(r.warnings[0]).toMatch(/strict/i);
    });
  });

  describe("env HARNESS_CR_PROFILE (priority 2)", () => {
    it("env=assertive を採用 + source=env", () => {
      const r = resolveProfile({ env: "assertive" });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("env");
    });

    it("env=strict (harness-local extension) を allowStrict default 時は許可", () => {
      const r = resolveProfile({ env: "strict" });
      expect(r.profile).toBe("strict");
      expect(r.source).toBe("env");
    });

    it("env が harnessConfigProfile / yamlProfile より優先", () => {
      const r = resolveProfile({
        env: "strict",
        harnessConfigProfile: "chill",
        yamlProfile: "assertive",
      });
      expect(r.profile).toBe("strict");
      expect(r.source).toBe("env");
    });

    it("env invalid 値は警告 + harnessConfigProfile へ fallthrough", () => {
      const r = resolveProfile({ env: "wild", harnessConfigProfile: "assertive" });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("harness-config");
      expect(r.warnings[0]).toMatch(/env.*invalid|invalid.*env/i);
      expect(r.warnings[0]).toMatch(/wild/);
    });

    it("env=undefined / 空文字は無視 (警告なし)", () => {
      expect(resolveProfile({ env: undefined }).warnings).toEqual([]);
      expect(resolveProfile({ env: "" }).warnings).toEqual([]);
    });

    it("空白のみの env 値は trim 後 empty として無視 (警告なし、source=default)", () => {
      const r = resolveProfile({ env: "   " });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("default");
      expect(r.warnings).toEqual([]);
    });

    it("trim されてから validate される (空白付き env=' chill ' は採用)", () => {
      const r = resolveProfile({ env: "  chill  " });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("env");
    });
  });

  describe("harnessConfigProfile (priority 3)", () => {
    it("harnessConfigProfile=strict を採用 + source=harness-config", () => {
      const r = resolveProfile({ harnessConfigProfile: "strict" });
      expect(r.profile).toBe("strict");
      expect(r.source).toBe("harness-config");
    });

    it("harnessConfigProfile が yamlProfile より優先", () => {
      const r = resolveProfile({
        harnessConfigProfile: "assertive",
        yamlProfile: "chill",
      });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("harness-config");
    });

    it("config loader が validated 後の値を渡す前提なので警告なし", () => {
      // loadConfig で type guard 済みの場合、resolver は値を信頼する
      const r = resolveProfile({ harnessConfigProfile: "chill" });
      expect(r.warnings).toEqual([]);
    });

    it("allowStrict=false で harnessConfigProfile=strict は警告 + yamlProfile へ", () => {
      const r = resolveProfile({
        harnessConfigProfile: "strict",
        yamlProfile: "assertive",
        allowStrict: false,
      });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("coderabbit-yaml");
      expect(r.warnings[0]).toMatch(/strict/i);
      expect(r.warnings[0]).toMatch(/harness-config|harness\.config/i);
    });
  });

  describe("yamlProfile (priority 4)", () => {
    it("yamlProfile=chill を採用 + source=coderabbit-yaml", () => {
      const r = resolveProfile({ yamlProfile: "chill" });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("coderabbit-yaml");
    });

    it("yamlProfile=assertive を採用", () => {
      const r = resolveProfile({ yamlProfile: "assertive" });
      expect(r.profile).toBe("assertive");
      expect(r.source).toBe("coderabbit-yaml");
    });

    it("yamlProfile=strict は CodeRabbit 公式 schema 範囲外 → 警告 + default 移行", () => {
      const r = resolveProfile({ yamlProfile: "strict" });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("default");
      expect(r.warnings[0]).toMatch(/yaml|coderabbit\.yaml/i);
      expect(r.warnings[0]).toMatch(/strict/i);
    });

    it("yamlProfile invalid 値 (例: 'verbose') は警告 + default", () => {
      const r = resolveProfile({ yamlProfile: "verbose" });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("default");
      expect(r.warnings[0]).toMatch(/verbose/);
    });

    it("yamlProfile=undefined は無視", () => {
      const r = resolveProfile({ yamlProfile: undefined });
      expect(r.profile).toBe("chill");
      expect(r.source).toBe("default");
      expect(r.warnings).toEqual([]);
    });
  });

  describe("複数 source 連鎖と source 表記", () => {
    it("invalid cli + invalid env → harnessConfig が採用される、警告 2 件", () => {
      const r = resolveProfile({
        cliFlag: "loose",
        env: "wild",
        harnessConfigProfile: "strict",
      });
      expect(r.profile).toBe("strict");
      expect(r.source).toBe("harness-config");
      expect(r.warnings.length).toBe(2);
    });

    it("invalid 値が複数あっても resolver は throw しない (graceful degradation)", () => {
      expect(() =>
        resolveProfile({
          cliFlag: "x",
          env: "y",
          harnessConfigProfile: "strict",
          yamlProfile: "z",
        }),
      ).not.toThrow();
    });
  });

  describe("API 契約", () => {
    it("VALID_PROFILES は readonly array で chill/assertive/strict を含む", () => {
      expect(VALID_PROFILES).toEqual(["chill", "assertive", "strict"]);
      // immutability 検証 (readonly tuple として TS で保証されるが、runtime も確認)
      const profiles: readonly CoderabbitProfile[] = VALID_PROFILES;
      expect(profiles.length).toBe(3);
    });

    it("ProfileResolution は profile / source / warnings の 3 field", () => {
      const r: ProfileResolution = resolveProfile({});
      expect(r).toHaveProperty("profile");
      expect(r).toHaveProperty("source");
      expect(r).toHaveProperty("warnings");
      expect(Array.isArray(r.warnings)).toBe(true);
    });
  });
});
