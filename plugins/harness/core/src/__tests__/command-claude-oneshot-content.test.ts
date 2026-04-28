/**
 * core/src/__tests__/command-claude-oneshot-content.test.ts
 *
 * `commands/claude-oneshot.md` skill content の strict pre-parse regression.
 *
 * 目的:
 *   `claude-oneshot` skill は parallel-worktree v2 / session-manager から
 *   呼ばれる「per-task primitive」。frontmatter / Required sections /
 *   `claude -p` invocation contract / per-slug log path / 関連 skill との
 *   cross-link / generic spec hygiene を文字列レベルで lock-in する。
 *
 * 対応する harness rule:
 *   - generality.test.ts blocklist (B-1 〜 B-3g)
 *   - CONTRIBUTING.md §1.2 (internal tracker ID 持ち込み禁止)
 *   - parallel-worktree-v2-design.md (downstream coordinator primitive 契約)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

function readCommand(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "commands", `${name}.md`), "utf-8");
}

describe("claude-oneshot skill: frontmatter contract", () => {
  const content = readCommand("claude-oneshot");

  it("declares the skill name as `claude-oneshot`", () => {
    expect(content).toMatch(/^---[\s\S]*?\nname:\s*claude-oneshot\b/);
  });

  it("declares allowed-tools array including Bash", () => {
    expect(content).toMatch(/allowed-tools:\s*\[[^\]]*"Bash"/);
  });

  it("declares an argument-hint that documents instruction token", () => {
    // strict format `[instruction|...]`: 旧 free-form `<instruction>` を strict bracket に migrate
    expect(content).toMatch(/argument-hint:\s*["']\[instruction\|/);
  });

  it("description mentions non-interactive `claude -p` wrapper", () => {
    expect(content).toMatch(
      /description:[\s\S]{0,400}?(?:non-interactive|one-shot)[\s\S]{0,200}?(?:claude\s+-p|`claude -p`)/i,
    );
  });
});

describe("claude-oneshot skill: required sections", () => {
  const content = readCommand("claude-oneshot");

  it("documents the Purpose section", () => {
    expect(content).toMatch(/^##\s*Purpose\b/m);
  });

  it("documents When to use guidance", () => {
    expect(content).toMatch(/^##\s*When\s+to\s+use\b/im);
  });

  it("documents When NOT to use guidance (delineates from Agent tool)", () => {
    expect(content).toMatch(/^##\s*When\s+NOT\s+to\s+use\b/im);
    // backtick-wrapped or plain — accept both `Agent` tool / Agent tool / `Agent tool`
    expect(content).toMatch(/`?Agent`?[\s`]+tool/i);
  });

  it("documents the Arguments table", () => {
    expect(content).toMatch(/^##\s*Arguments\b/im);
  });

  it("documents the Output contract", () => {
    expect(content).toMatch(/^##\s*Output\s+contract\b/im);
  });

  it("provides How to invoke example block", () => {
    expect(content).toMatch(/^##\s*How\s+to\s+invoke\b/im);
  });

  it("provides an Implementation outline (bash invocation)", () => {
    expect(content).toMatch(/^##\s*Implementation\s+outline\b/im);
  });
});

describe("claude-oneshot skill: claude -p invocation contract", () => {
  const content = readCommand("claude-oneshot");

  it("references `claude -p` with `--output-format` flag", () => {
    expect(content).toMatch(/claude\s+-p[\s\S]{0,400}?--output-format/);
  });

  it("supports stream-json output for monitoring", () => {
    expect(content).toMatch(/stream-json/);
  });

  it("references --permission-mode for sandbox control", () => {
    expect(content).toMatch(/--permission-mode/);
  });

  it("references --add-dir for working directory passthrough", () => {
    expect(content).toMatch(/--add-dir/);
  });
});

describe("claude-oneshot skill: per-slug log file contract", () => {
  const content = readCommand("claude-oneshot");

  it("writes to `/tmp/claude-log-<slug>.jsonl` by default", () => {
    expect(content).toMatch(/\/tmp\/claude-log-<slug>\.jsonl/);
  });

  it("supports overriding log dir via CLAUDE_ONESHOT_LOG_DIR env var", () => {
    expect(content).toMatch(/CLAUDE_ONESHOT_LOG_DIR/);
  });

  it("returns the spawned PID so the caller can wait or kill it", () => {
    expect(content).toMatch(/PID|process\s*id/i);
    expect(content).toMatch(/wait|kill/i);
  });
});

describe("claude-oneshot skill: integration cross-links", () => {
  const content = readCommand("claude-oneshot");

  it("cross-links to session-manager (log file consumer)", () => {
    expect(content).toMatch(/session-manager(?:\.ts)?/);
  });

  it("cross-links to parallel-worktree v2 (downstream coordinator)", () => {
    expect(content).toMatch(/parallel-worktree-?v?2|parallel-worktree.*v2/i);
  });

  it("cross-links to parallel-sessions-template.sh (tmux-based launcher alternative)", () => {
    expect(content).toMatch(/parallel-sessions-template\.sh/);
  });
});

describe("claude-oneshot skill: generic spec hygiene", () => {
  const content = readCommand("claude-oneshot");

  it("uses generic <slug> placeholder", () => {
    expect(content).toMatch(/<slug>/);
  });

  it("uses generic <instruction> placeholder", () => {
    expect(content).toMatch(/<instruction>/);
  });

  it("does not leak internal tracker IDs (Round N / 申送 M-NN / A-N rM)", () => {
    expect(content).not.toMatch(/\bRound\s*\d+\b/);
    expect(content).not.toMatch(/申送\s*[A-Z]-\d+/);
    expect(content).not.toMatch(/\b[Aa]-\d+\s*r\d+/);
  });

  it("does not reference test-bed branch names", () => {
    expect(content).not.toMatch(/feature\/new-partslist/);
    expect(content).not.toMatch(/feature\/harness-model-b/);
  });
});

describe("claude-oneshot skill: strict frontmatter fields (Finding #5)", () => {
  const content = readCommand("claude-oneshot");

  it("declares description-ja field with Japanese 1-line summary", () => {
    expect(content).toMatch(/^---[\s\S]*?\ndescription-ja:\s*".+?"/m);
  });

  it("argument-hint uses strict bracketed pipe-separated format [arg1|arg2|...]", () => {
    expect(content).toMatch(/^---[\s\S]*?\nargument-hint:\s*"\[[\w-]+(?:\|[\w-]+)+\]"/m);
  });
});
