import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");
const CODEX_PLUGIN_ROOT = resolve(REPO_ROOT, "plugins/codex-harness");

const VERB_COMMANDS = new Set([
  "harness-plan",
  "harness-work",
  "harness-review",
  "harness-release",
  "harness-setup",
]);

function readRepoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf-8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}

function listSkillNames(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root)
    .filter((entry) => {
      const fullPath = resolve(root, entry);
      return statSync(fullPath).isDirectory()
        && existsSync(resolve(fullPath, "SKILL.md"));
    })
    .sort();
}

function manifestBasenames(paths: string[]): string[] {
  return paths.map((path) => basename(path, ".md"));
}

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start === -1) {
    throw new Error(`Heading not found: ${heading}`);
  }

  const next = content.indexOf("\n### ", start + heading.length);
  return next === -1 ? content.slice(start) : content.slice(start, next);
}

function extractRange(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Start marker not found: ${startMarker}`);
  }

  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    throw new Error(`End marker not found: ${endMarker}`);
  }

  return content.slice(start, end);
}

function extractBacktickNames(content: string): string[] {
  return [...content.matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort();
}

function extractBacktickNamesFromSentence(content: string, marker: string): string[] {
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new Error(`Marker not found: ${marker}`);
  }

  const end = content.indexOf(".", start);
  const sentence = end === -1 ? content.slice(start) : content.slice(start, end);
  return extractBacktickNames(sentence);
}

function extractTableBacktickNames(content: string, prefix = ""): string[] {
  return [...content.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((match) => match[1].replace(prefix, ""))
    .sort();
}

describe("public docs stay aligned with plugin manifests", () => {
  const claudeManifest = readJson<{ commands: string[]; agents: string[] }>(
    "plugins/harness/.claude-plugin/plugin.json",
  );
  const hooksJson = readJson<{ hooks: Record<string, unknown> }>(
    "plugins/harness/hooks/hooks.json",
  );

  const commandNames = manifestBasenames(claudeManifest.commands).sort();
  const agentNames = manifestBasenames(claudeManifest.agents).sort();
  const verbCount = commandNames.filter((name) => VERB_COMMANDS.has(name)).length;
  const workflowCount = commandNames.length - verbCount;
  const hookEventCount = Object.keys(hooksJson.hooks).length;
  const codexSkillNames = listSkillNames(resolve(CODEX_PLUGIN_ROOT, "skills"));

  it("docs/en/commands.md declares command counts from plugin.json", () => {
    const commandsDoc = readRepoFile("docs/en/commands.md");
    const commandListSection = extractRange(
      commandsDoc,
      "## Verb skills",
      "## `/harness-work` auto-mode detection",
    );

    expect(commandsDoc).toContain(
      `The harness ships ${commandNames.length} commands: ${verbCount} verb skills`,
    );
    expect(commandsDoc).toContain(`plus ${workflowCount} workflow skills`);
    expect(extractTableBacktickNames(commandListSection, "/")).toEqual(commandNames);

    for (const commandName of commandNames) {
      expect(commandsDoc, `missing /${commandName}`).toContain(
        `/${commandName}`,
      );
    }
  });

  it("README.md declares manifest command and hook counts", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain(
      `**${commandNames.length} slash commands**: ${verbCount} verb`,
    );
    expect(readme).toContain(`plus ${workflowCount} workflow primitives`);
    expect(readme).toContain(
      `All 13 guardrails, ${commandNames.length} commands (${verbCount} verb + ${workflowCount} workflow)`,
    );
    expect(readme).toContain(`all ${hookEventCount} lifecycle hooks`);
  });

  it("README.md Codex adapter section lists every Codex skill entrypoint", () => {
    const readme = readRepoFile("README.md");
    const codexSection = extractSection(readme, "### Codex local adapter");

    expect(extractBacktickNamesFromSentence(
      codexSection,
      "Current Codex skills are",
    )).toEqual(codexSkillNames);

    for (const skillName of codexSkillNames) {
      expect(codexSection, `missing Codex skill ${skillName}`).toContain(
        `\`${skillName}\``,
      );
    }
  });

  it("agent docs and architecture mention manifest counts and agents", () => {
    const agentsDoc = readRepoFile("docs/en/agents.md");
    const architectureDoc = readRepoFile("docs/en/architecture.md");
    const japaneseArchitectureDoc = readRepoFile("docs/ja/architecture.md");

    expect(extractTableBacktickNames(agentsDoc)).toEqual(agentNames);

    for (const agentName of agentNames) {
      expect(agentsDoc, `docs/en/agents.md missing ${agentName}`).toContain(
        `\`${agentName}\``,
      );
    }

    expect(architectureDoc).toContain(
      `**Skills** — ${commandNames.length} commands: ${verbCount} verb commands`,
    );
    expect(architectureDoc).toContain(
      `plus ${workflowCount} workflow commands under \`commands/\``,
    );
    expect(architectureDoc).toContain(
      `**Agents** — ${agentNames.length} specialised agents`,
    );
    expect(japaneseArchitectureDoc).toContain(
      `**スキル** — ${commandNames.length} コマンド: ${verbCount} 動詞コマンド`,
    );
    expect(japaneseArchitectureDoc).toContain(
      `と ${workflowCount} workflow コマンド`,
    );
    expect(japaneseArchitectureDoc).toContain(
      `**エージェント** — ${agentNames.length} エージェント`,
    );
  });

  it(".coderabbit.yaml review guidance declares manifest-derived counts", () => {
    const coderabbitYaml = readRepoFile(".coderabbit.yaml");
    const hookEvents = Object.keys(hooksJson.hooks).sort();

    expect(coderabbitYaml).toContain(
      `# agents frontmatter (plugin-scoped subagent ${agentNames.length} 件)`,
    );
    expect(coderabbitYaml).toContain(
      `# commands (${verbCount} verb skills + ${workflowCount} workflow skills = ${commandNames.length} commands)`,
    );
    expect(coderabbitYaml).toContain(
      `# hooks.json (${hookEventCount} lifecycle events)`,
    );
    expect(coderabbitYaml).toContain(`現在登録済 ${hookEventCount} events:`);

    for (const hookEvent of hookEvents) {
      expect(coderabbitYaml, `.coderabbit.yaml missing ${hookEvent}`).toContain(
        `\`${hookEvent}\``,
      );
    }

    expect(coderabbitYaml).toContain(`e.g. "${commandNames.length} commands"`);
    expect(coderabbitYaml).toContain(
      `e.g. "${hookEventCount} lifecycle hook events"`,
    );
  });
});
