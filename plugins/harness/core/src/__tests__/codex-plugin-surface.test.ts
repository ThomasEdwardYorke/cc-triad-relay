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
import { parse as parseToml } from "smol-toml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(CLAUDE_PLUGIN_ROOT, "../..");
const CODEX_PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/codex-harness");

const EXPECTED_CODEX_SKILLS = [
  "clarify",
  "harness-plan",
  "harness-work",
  "harness-review",
  "harness-setup",
  "tdd-implement",
  "session-handoff",
  "context-audit",
  "coderabbit-review",
  "pseudo-coderabbit-loop",
  "new-feature-branch",
  "branch-merge",
  "harness-release",
  "harness-merge-train",
  "harness-self-improve",
  "parallel-worktree",
  "codex-team",
] as const;

const TDD_GATED_CODEX_SKILLS = [
  "harness-work",
  "tdd-implement",
  "pseudo-coderabbit-loop",
  "branch-merge",
  "harness-release",
  "harness-merge-train",
  "parallel-worktree",
  "codex-team",
] as const;

const SECOND_OPINION_CODEX_SKILLS = [
  "harness-work",
  "harness-review",
  "tdd-implement",
  "coderabbit-review",
  "pseudo-coderabbit-loop",
  "branch-merge",
  "harness-release",
  "harness-merge-train",
  "parallel-worktree",
  "codex-team",
] as const;

const BRANCH_RELEASE_CODEX_SKILLS = [
  "new-feature-branch",
  "branch-merge",
  "harness-release",
  "harness-merge-train",
] as const;

const PARALLEL_CODEX_SKILLS = [
  "parallel-worktree",
  "codex-team",
] as const;

const CODEX_SETUP_TEMPLATE_FILES = [
  "plugins/codex-harness/skills/harness-setup/assets/AGENTS.md.tmpl",
  "plugins/codex-harness/skills/harness-setup/assets/codex-config.toml.tmpl",
] as const;

const SESSION_BRANCH_PATTERN =
  /\bfeature\/(?=[A-Za-z0-9._/-]*(?:[A-Z]+-\d+|[0-9a-f]{7,40}))[A-Za-z0-9._/-]+/i;

const CLAUDE_ONLY_NON_EQUIVALENTS = [
  "claude-oneshot",
  "parallel-worktree-v2",
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

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  expect(isRecord(value), `${label} must be a table`).toBe(true);
  return isRecord(value) ? value : {};
}

function expectNoActiveSessionState(surface: string): void {
  expect(surface).not.toMatch(/\/Users\//);
  expect(surface).not.toMatch(SESSION_BRANCH_PATTERN);
  const currentBranch = gitLines(["branch", "--show-current"])[0] ?? "";
  if (currentBranch.startsWith("feature/")) {
    expect(surface).not.toContain(currentBranch);
  }
  expect(surface).not.toMatch(/\b[0-9a-f]{7,40}\b/i);
  expect(surface).not.toMatch(/\bPR\s+#\d+\b/i);
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
      hooks: "./hooks/hooks.json",
      interface: {
        displayName: "Codex Harness",
        category: "Coding",
      },
    });
    expect(manifest).not.toHaveProperty("commands");
    expect(manifest).not.toHaveProperty("agents");
  });

  it("wires Codex plugin hooks through the Codex adapter root", () => {
    const hooksConfig = readJson("plugins/codex-harness/hooks/hooks.json");
    expect(isRecord(hooksConfig)).toBe(true);
    if (!isRecord(hooksConfig)) return;

    expect(isRecord(hooksConfig.hooks)).toBe(true);
    if (!isRecord(hooksConfig.hooks)) return;

    const expectedEvents = [
      "PreToolUse",
      "PermissionRequest",
      "UserPromptSubmit",
      "Stop",
    ] as const;
    expect(Object.keys(hooksConfig.hooks).sort()).toEqual(
      [...expectedEvents].sort(),
    );

    for (const eventName of expectedEvents) {
      const entries = hooksConfig.hooks[eventName];
      expect(Array.isArray(entries)).toBe(true);
      expect((entries as unknown[]).length).toBeGreaterThan(0);
      for (const entry of entries as unknown[]) {
        expect(isRecord(entry)).toBe(true);
        if (!isRecord(entry)) continue;
        if (eventName === "PreToolUse" || eventName === "PermissionRequest") {
          expect(entry.matcher).toBe(
            "Bash|Shell|functions\\.exec_command|functions\\.shell_command|exec_command|shell_command",
          );
        }

        const hookList = entry.hooks;
        expect(Array.isArray(hookList)).toBe(true);
        expect((hookList as unknown[]).length).toBeGreaterThan(0);
        for (const hook of hookList as unknown[]) {
          expect(isRecord(hook)).toBe(true);
          if (!isRecord(hook)) continue;

          expect(hook).toMatchObject({
            type: "command",
            timeout: 30,
          });
          expect(String(hook.command)).toContain("${PLUGIN_ROOT}");
          expect(String(hook.command)).toContain(
            "hooks/codex-hook-dispatcher.mjs",
          );
          expect(String(hook.command)).not.toContain("CLAUDE_PLUGIN_ROOT");
        }
      }
    }

    expect(
      existsSync(resolve(CODEX_PLUGIN_ROOT, "hooks", "codex-hook-dispatcher.mjs")),
    ).toBe(true);
  });

  it("exposes the Codex-native skill entrypoints", () => {
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
      expect(content).not.toContain("allowed-tools");
      expect(content).not.toContain("disable-model-invocation");
      expect(content).not.toContain("argument-hint");
      expect(content).not.toContain("description-ja");
    }
  });

  it("keeps TDD wording on Codex skills that can change implementation state", () => {
    for (const skillName of TDD_GATED_CODEX_SKILLS) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);

      expect(content).toContain("RED");
      expect(content).toContain("GREEN");
      expect(content).toMatch(/local review/i);
    }
  });

  it("adds Codex-native planning, review, setup, context, and self-improvement parity skills", () => {
    const expectations: Record<string, string[]> = {
      "clarify": [
        "Decision boundary gate",
        "Question cadence gate",
        "No-code gate",
        "depth-first",
      ],
      "harness-plan": [
        "Plan source-of-truth gate",
        "Task split gate",
        "Acceptance criteria gate",
        "handoff",
      ],
      "harness-review": [
        "Read-only review gate",
        "Finding severity gate",
        "No-patch gate",
        "file/line",
      ],
      "harness-setup": [
        "Setup boundary gate",
        "Configuration template gate",
        "Verification gate",
        "harness.config.json",
      ],
      "context-audit": [
        "Context source gate",
        "Budget and discoverability gate",
        "Actionable report gate",
        "MCP",
      ],
      "harness-self-improve": [
        "Archive mining gate",
        "Proposal boundary gate",
        "Backlog update gate",
        "session-handoff archive",
      ],
    };

    for (const [skillName, requiredPhrases] of Object.entries(expectations)) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);
      for (const phrase of requiredPhrases) {
        expect(content, `${skillName} missing ${phrase}`).toContain(phrase);
      }
    }
  });

  it("publishes generic Codex setup guidance and templates", () => {
    const harnessSetup = readRepoFile(
      "plugins/codex-harness/skills/harness-setup/SKILL.md",
    );
    const readme = readRepoFile("plugins/codex-harness/README.md");
    const platformAdapters = readRepoFile("docs/maintainer/platform-adapters.md");
    const combinedDocs = `${harnessSetup}\n${readme}\n${platformAdapters}`;

    for (const path of CODEX_SETUP_TEMPLATE_FILES) {
      expect(existsSync(repoPath(path)), `${path} must exist`).toBe(true);
    }

    const agentsTemplate = readRepoFile(CODEX_SETUP_TEMPLATE_FILES[0]);
    const configTemplate = readRepoFile(CODEX_SETUP_TEMPLATE_FILES[1]);
    const setupSurface = `${combinedDocs}\n${agentsTemplate}\n${configTemplate}`;
    const templateSurface = `${agentsTemplate}\n${configTemplate}`;
    const parsedConfig = expectRecord(
      parseToml(configTemplate) as unknown,
      "codex config template",
    );

    expect(harnessSetup).toContain("Durable guidance gate");
    expect(harnessSetup).toContain("Codex config defaults gate");
    expect(harnessSetup).toContain("AGENTS.md");
    expect(harnessSetup).toContain(".codex/config.toml");
    expect(harnessSetup).toContain("assets/AGENTS.md.tmpl");
    expect(harnessSetup).toContain("assets/codex-config.toml.tmpl");

    expect(agentsTemplate).toContain("## Repository Expectations");
    expect(agentsTemplate).toContain("## Harness Workflow");
    expect(agentsTemplate).toContain("## Task-Specific References");
    expect(agentsTemplate).toContain("## Local-Only State");
    expect(agentsTemplate).toContain(".docs/handoff/");
    expect(agentsTemplate).toContain("harness.config.json");
    expect(agentsTemplate).not.toContain("docs/maintainer/handoff");

    for (const requiredConfigKey of [
      "model",
      "review_model",
      "approval_policy",
      "sandbox_mode",
      "sandbox_workspace_write.network_access",
      "project_doc_max_bytes",
      "project_doc_fallback_filenames",
      "auto_review.policy",
      "mcp_servers",
      "features.hooks",
      "features.plugin_hooks",
    ]) {
      expect(configTemplate, `missing ${requiredConfigKey}`).toContain(
        requiredConfigKey,
      );
      expect(setupSurface, `docs missing ${requiredConfigKey}`).toContain(
        requiredConfigKey,
      );
    }

    expect(parsedConfig.model).toBe("gpt-5.5");
    expect(parsedConfig.review_model).toBe("gpt-5.5");
    expect(parsedConfig.approval_policy).toBe("on-request");
    expect(parsedConfig.sandbox_mode).toBe("workspace-write");
    expect(parsedConfig.project_doc_max_bytes).toBe(32768);
    expect(parsedConfig.project_doc_fallback_filenames).toEqual([]);

    const sandboxWorkspaceWrite = expectRecord(
      parsedConfig.sandbox_workspace_write,
      "sandbox_workspace_write",
    );
    expect(sandboxWorkspaceWrite.network_access).toBe(false);

    const autoReview = expectRecord(parsedConfig.auto_review, "auto_review");
    expect(autoReview.policy).toEqual(expect.any(String));
    expect(String(autoReview.policy)).toMatch(/public\/local boundary leaks/i);

    const features = expectRecord(parsedConfig.features, "features");
    expect(features.hooks).toBe(true);
    expect(features.plugin_hooks).toBe(true);

    const mcpServers = expectRecord(parsedConfig.mcp_servers, "mcp_servers");
    const exampleServer = expectRecord(mcpServers.example, "mcp_servers.example");
    expect(exampleServer).toMatchObject({
      enabled: false,
      command: "example-mcp-server",
      args: [],
      env: {},
    });

    for (const phrase of [
      "sandbox",
      "approval",
      "model",
      "MCP",
      "review-policy",
      "local-only",
      "project-scoped",
    ]) {
      expect(setupSurface).toMatch(new RegExp(escapeRegExp(phrase), "i"));
    }

    expect("feature/my-feature").not.toMatch(SESSION_BRANCH_PATTERN);
    expect("feature/T-016-codex-guidance").toMatch(SESSION_BRANCH_PATTERN);
    expect("feature/86182b2-codex-guidance").toMatch(SESSION_BRANCH_PATTERN);
    expectNoActiveSessionState(setupSurface);
    expect(templateSurface).not.toContain("docs/maintainer/handoff");
  });

  it("documents Codex handoff lifecycle parity without Claude-only metadata", () => {
    const sessionHandoff = readRepoFile(
      "plugins/codex-harness/skills/session-handoff/SKILL.md",
    );
    const harnessWork = readRepoFile(
      "plugins/codex-harness/skills/harness-work/SKILL.md",
    );

    expect(sessionHandoff).toMatch(/check\s*->\s*update\s*->\s*archive/i);
    expect(sessionHandoff).toMatch(/next-session quick-start/i);
    expect(sessionHandoff).toMatch(/current branch/i);
    expect(sessionHandoff).toMatch(/current commit/i);
    expect(sessionHandoff).toMatch(/PR\/CodeRabbit\/CI state/i);
    expect(sessionHandoff).toMatch(/remaining tasks/i);
    expect(sessionHandoff).toContain(
      "git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff",
    );

    expect(harnessWork).toMatch(/session-handoff check/i);
    expect(harnessWork).toMatch(/session-handoff update/i);
    expect(harnessWork).toMatch(/session-handoff archive/i);
    expect(harnessWork).toMatch(
      /Before ending any implementation session[\s\S]*branch[\s\S]*PR[\s\S]*CodeRabbit\/CI state[\s\S]*session-handoff archive/i,
    );
    expect(harnessWork).not.toMatch(/long-running implementation session/i);

    expect(sessionHandoff).not.toContain("allowed-tools");
    expect(sessionHandoff).not.toContain("argument-hint");
    expect(sessionHandoff).not.toContain("description-ja");
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

  it("publishes Codex-native branch, release, and merge-train skills with release guards", () => {
    for (const skillName of BRANCH_RELEASE_CODEX_SKILLS) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);

      expect(content).toMatch(/^---\r?\n/);
      expect(content).toMatch(
        new RegExp(`^name: ${escapeRegExp(skillName)}$`, "m"),
      );
      expect(content).toContain("Branch safety gate");
      expect(content).toContain("Release-to-main gate");
      expect(content).toContain("Local-only boundary gate");
      expect(content).toContain("release PR");
      expect(content).toContain("Do not push directly to `main`");
      expect(content).toContain(
        "git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff",
      );
      expect(content).not.toContain("allowed-tools");
      expect(content).not.toContain("disable-model-invocation");
      expect(content).not.toContain("argument-hint");
      expect(content).not.toContain("description-ja");
    }

    const readme = readRepoFile("plugins/codex-harness/README.md");
    for (const skillName of BRANCH_RELEASE_CODEX_SKILLS) {
      expect(readme).toContain(`\`${skillName}\``);
    }
  });

  it("publishes Codex-native parallel orchestration skills with isolation and concurrency guards", () => {
    for (const skillName of PARALLEL_CODEX_SKILLS) {
      const skillPath = `plugins/codex-harness/skills/${skillName}/SKILL.md`;
      const content = readRepoFile(skillPath);

      expect(content).toMatch(/^---\r?\n/);
      expect(content).toMatch(
        new RegExp(`^name: ${escapeRegExp(skillName)}$`, "m"),
      );
      expect(content).toContain("Worktree isolation gate");
      expect(content).toContain("Ownership boundary gate");
      expect(content).toContain("Concurrency gate");
      expect(content).toContain("Merge ordering gate");
      expect(content).toContain("Codex second-opinion gate");
      expect(content).toContain("Local-only boundary gate");
      expect(content).toContain("MAX_CODEX_PARALLEL");
      expect(content).toContain("owned_files");
      expect(content).toContain("forbidden_files");
      expect(content).toContain("Do not share writable worktrees");
      expect(content).toContain("Do not push directly to `main`");
      expect(content).not.toContain("allowed-tools");
      expect(content).not.toContain("disable-model-invocation");
      expect(content).not.toContain("argument-hint");
      expect(content).not.toContain("description-ja");
      expect(content).not.toContain("claude-oneshot");
    }

    const readme = readRepoFile("plugins/codex-harness/README.md");
    for (const skillName of PARALLEL_CODEX_SKILLS) {
      expect(readme).toContain(`\`${skillName}\``);
    }
    expect(readme).toContain("Parallel Orchestration Contract");
  });

  it("documents Claude-only primitives as intentional Codex non-equivalents", () => {
    for (const skillName of CLAUDE_ONLY_NON_EQUIVALENTS) {
      expect(
        existsSync(resolve(CODEX_PLUGIN_ROOT, "skills", skillName)),
        `${skillName} should not be exposed as a direct Codex skill`,
      ).toBe(false);
    }

    const readme = readRepoFile("plugins/codex-harness/README.md");
    const platformAdapters = readRepoFile("docs/maintainer/platform-adapters.md");
    const combinedDocs = `${readme}\n${platformAdapters}`;

    for (const skillName of CLAUDE_ONLY_NON_EQUIVALENTS) {
      expect(combinedDocs).toContain(skillName);
    }
    expect(combinedDocs).toContain("not copied as direct Codex skills");
    expect(combinedDocs).toContain("Codex subagents and isolated worktrees");
    expect(combinedDocs).toContain("Claude-only primitive");
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
    expect(existsSync(resolve(CODEX_PLUGIN_ROOT, "hooks"))).toBe(true);

    const codexFiles = listFiles(CODEX_PLUGIN_ROOT);
    const codexSurface = codexFiles
      .map((path) => readFileSync(path, "utf-8"))
      .join("\n");
    expect(codexSurface).not.toContain(".claude-plugin");
    expect(codexSurface).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(codexSurface).toContain("${PLUGIN_ROOT}");

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
    expect(readme).toContain("[features]");
    expect(readme).toContain("hooks = true");
    expect(readme).toContain("plugin_hooks = true");
    expect(readme).toContain("/hooks");
    expect(docs).toContain("Plugin hooks are off by default");

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
