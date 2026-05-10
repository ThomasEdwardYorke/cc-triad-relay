import { describe, expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(CLAUDE_PLUGIN_ROOT, "../..");
const CODEX_PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/codex-harness");

const EXPECTED_CODEX_SKILLS = [
  "harness-work",
  "tdd-implement",
  "session-handoff",
  "coderabbit-review",
  "pseudo-coderabbit-loop",
] as const;

const SECOND_OPINION_CODEX_SKILLS = [
  "harness-work",
  "tdd-implement",
  "coderabbit-review",
  "pseudo-coderabbit-loop",
] as const;

function repoPath(path: string): string {
  return resolve(REPO_ROOT, path);
}

function readRepoFile(path: string): string {
  return readFileSync(repoPath(path), "utf-8");
}

function readJson(path: string): unknown {
  return JSON.parse(readRepoFile(path)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = resolve(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...listFiles(fullPath));
    } else if (stat.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

function gitLines(args: string[]): string[] {
  const out = execFileSync("git", ["-C", REPO_ROOT, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return out.length === 0 ? [] : out.split(/\r?\n/);
}

describe("Codex plugin platform surface", () => {
  it("publishes a repo-local Codex marketplace entry", () => {
    const marketplace = readJson(".agents/plugins/marketplace.json");
    expect(isRecord(marketplace)).toBe(true);
    if (!isRecord(marketplace)) return;

    expect(marketplace.name).toBe("cc-triad-relay");
    expect(marketplace.interface).toMatchObject({
      displayName: "cc-triad-relay",
    });

    expect(Array.isArray(marketplace.plugins)).toBe(true);
    const plugins = marketplace.plugins as unknown[];
    const entry = plugins.find(
      (plugin): plugin is Record<string, unknown> =>
        isRecord(plugin) && plugin.name === "codex-harness",
    );

    expect(entry).toMatchObject({
      name: "codex-harness",
      source: {
        source: "local",
        path: "./plugins/codex-harness",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Coding",
    });
  });

  it("publishes a Codex manifest that uses skills as the entry surface", () => {
    const manifest = readJson(
      "plugins/codex-harness/.codex-plugin/plugin.json",
    );
    expect(isRecord(manifest)).toBe(true);
    if (!isRecord(manifest)) return;

    expect(manifest).toMatchObject({
      name: "codex-harness",
      version: "0.4.0-rc.2",
      license: "MIT",
      skills: "./skills/",
      interface: {
        displayName: "Codex Harness",
        category: "Coding",
      },
    });
    expect(manifest).not.toHaveProperty("commands");
    expect(manifest).not.toHaveProperty("agents");
  });

  it("exposes the first Codex-native skill entrypoints", () => {
    for (const skillName of EXPECTED_CODEX_SKILLS) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);

      expect(content).toMatch(/^---\r?\n/);
      expect(content).toMatch(
        new RegExp(`^name: ${escapeRegExp(skillName)}$`, "m"),
      );
      expect(content).toMatch(/^description: .+/m);
      expect(content).toContain("## Codex-Native Gates");
      expect(content).toContain("Repository and branch gate");
      expect(content).toContain("Local-only boundary gate");
      expect(content).toContain("RED");
      expect(content).toContain("GREEN");
      expect(content).toMatch(/local review/i);
    }
  });

  it("requires a fail-closed Codex second-opinion gate on review and implementation skills", () => {
    for (const skillName of SECOND_OPINION_CODEX_SKILLS) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);

      expect(content).toContain("Codex second-opinion gate");
      expect(content).toContain("Capability ladder");
      expect(content).toContain("Codex sub-agent");
      expect(content).toMatch(/`codex` CLI|codex CLI/);
      expect(content).toMatch(/fail-closed/i);
      expect(content).toContain("PASS | NEEDS_FIX | BLOCKED");
      expect(content).toContain("diff, PR context, and test results");
      expect(content).toMatch(
        /Do not mark .*clear.*second opinion.*PASS/is,
      );
    }
  });

  it("keeps the Codex second-opinion mechanism portable", () => {
    const codexFiles = listFiles(CODEX_PLUGIN_ROOT);
    const codexSurface = codexFiles
      .map((path) => readFileSync(path, "utf-8"))
      .join("\n");

    expect(codexSurface).not.toContain("ask-codex");
    expect(codexSurface).not.toContain(".agents/skills");
    expect(codexSurface).not.toContain(".claude/plugins/cache");
    expect(codexSurface).not.toContain("codex-companion.mjs");
  });

  it("keeps Claude Code and Codex adapter metadata separated", () => {
    expect(
      existsSync(resolve(CLAUDE_PLUGIN_ROOT, ".claude-plugin/plugin.json")),
    ).toBe(true);
    expect(
      existsSync(resolve(CLAUDE_PLUGIN_ROOT, ".codex-plugin/plugin.json")),
    ).toBe(false);
    expect(
      existsSync(resolve(CODEX_PLUGIN_ROOT, ".codex-plugin/plugin.json")),
    ).toBe(true);
    expect(
      existsSync(resolve(CODEX_PLUGIN_ROOT, ".claude-plugin/plugin.json")),
    ).toBe(false);
    expect(existsSync(resolve(CODEX_PLUGIN_ROOT, "commands"))).toBe(false);
    expect(existsSync(resolve(CODEX_PLUGIN_ROOT, "agents"))).toBe(false);
    expect(existsSync(resolve(CODEX_PLUGIN_ROOT, "hooks"))).toBe(false);

    const codexFiles = listFiles(CODEX_PLUGIN_ROOT);
    const codexSurface = codexFiles
      .map((path) => readFileSync(path, "utf-8"))
      .join("\n");
    expect(codexSurface).not.toContain(".claude-plugin");

    const claudeSurface = [
      "plugins/harness/.claude-plugin/plugin.json",
      ...listFiles(resolve(CLAUDE_PLUGIN_ROOT, "commands")).map((path) =>
        relative(REPO_ROOT, path),
      ),
      ...listFiles(resolve(CLAUDE_PLUGIN_ROOT, "agents")).map((path) =>
        relative(REPO_ROOT, path),
      ),
    ]
      .map((path) => readRepoFile(path))
      .join("\n");
    expect(claudeSurface).not.toContain(".codex-plugin");
    expect(claudeSurface).not.toContain("plugins/codex-harness");
  });

  it("documents adapter boundaries without tracking self-hosting state", () => {
    const docs = readRepoFile("docs/maintainer/platform-adapters.md");
    expect(docs).toContain("Claude Code adapter");
    expect(docs).toContain("Codex adapter");
    expect(docs).toContain("plugins/harness/");
    expect(docs).toContain("plugins/codex-harness/");
    expect(docs).toContain(".docs/handoff/");
    expect(docs).toContain("harness.config.json");

    const contributing = readRepoFile("CONTRIBUTING.md");
    expect(contributing).toContain("`.claude-plugin/**`");
    expect(contributing).toContain("`plugins/harness/**`");
    expect(contributing).toContain("`.agents/plugins/**`");
    expect(contributing).toContain("`plugins/codex-harness/**`");

    const readme = readRepoFile("README.md");
    expect(readme).toContain(
      "codex plugin marketplace add /path/to/project",
    );

    expect(
      gitLines([
        "ls-files",
        "--",
        "harness.config.json",
        ".docs/handoff/**",
        "docs/maintainer/handoff",
      ]),
    ).toEqual([]);
  });
});
