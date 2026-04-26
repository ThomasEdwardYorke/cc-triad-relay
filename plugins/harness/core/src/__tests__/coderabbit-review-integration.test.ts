/**
 * core/src/__tests__/coderabbit-review-integration.test.ts
 *
 * `/coderabbit-review` skill の本体 spec と、その caller 群が skill を bypass せず
 * 必須経由する構造を CI 時点で固定する integration content test。
 *
 * 背景:
 *   prior session で Real CodeRabbit 多 round loop を観測し、各 round の終了 signal
 *   が暗黙 (Monitor timeout) だったために polling 効率が悪く、unresolved=0 のみで
 *   Soft Clear に到達するパターンが続いていた。GitHub commit_status API が
 *   pending → success ("Review completed") を per-commit で発行することが LIVE 観測
 *   され、これを skill の primary signal に昇格 + caller 群に独自 polling 禁止を
 *   構造的に強制する。
 *
 * 対応する harness rule:
 *   - consumer-side implementation-workflow rule G6 (`/coderabbit-review` 経由)
 *   - CONTRIBUTING.md §3.1 (skill connectivity 原則)
 *
 * 期待 (高水準):
 *   1. `/coderabbit-review` Step 7 が 2 段判定 (Stop polling / Merge ready) を持つ
 *   2. `/coderabbit-review` Step 3 が commit_status watch (review count 待ちでない)
 *   3. `/coderabbit-review` に Step 6.5 (auto `@coderabbitai resolve` inject) がある
 *   4. caller 3 件 (harness-merge-train M5 / tdd-implement Phase 6 /
 *      harness-work Skill connectivity 原則 box) が `/coderabbit-review` 必須経由を明示
 *   5. `.coderabbit.yaml` の `request_changes_workflow: true` + `pre_merge_checks` 宣言
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");

const CR_REVIEW_PATH = resolve(PLUGIN_ROOT, "commands", "coderabbit-review.md");
const HARNESS_MERGE_TRAIN_PATH = resolve(PLUGIN_ROOT, "commands", "harness-merge-train.md");
const TDD_IMPLEMENT_PATH = resolve(PLUGIN_ROOT, "commands", "tdd-implement.md");
const HARNESS_WORK_PATH = resolve(PLUGIN_ROOT, "commands", "harness-work.md");
const CR_YAML_PATH = resolve(REPO_ROOT, ".coderabbit.yaml");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("/coderabbit-review skill internals (Stop polling / Merge ready 分離 + commit_status watch + auto-resolve)", () => {
  const content = read(CR_REVIEW_PATH);

  it("Step 7 に 2 段判定 (Stop polling + Merge ready) と STOP_POLLING / CLEAR_STRONG / CLEAR_SOFT 概念がある", () => {
    expect(content).toMatch(/STOP_POLLING/);
    expect(content).toMatch(/CLEAR_STRONG/);
    expect(content).toMatch(/CLEAR_SOFT/);
    // Stop polling と Merge ready の概念分離が明文化される
    expect(content).toMatch(/Stop\s*polling[\s\S]{0,400}Merge\s*ready|Merge\s*ready[\s\S]{0,400}Stop\s*polling/i);
  });

  it("Step 3 polling は commit_status state watch (review count 待ちでない)", () => {
    // commits/<sha>/status endpoint への参照、または commit_status state watch の明示
    expect(content).toMatch(/commits\/\$\{?[A-Z_]+\}?\/status|commit[_\s-]*status\s*(?:watch|state)/i);
    // 旧 review count polling が primary でなくなる: Step 3 section が
    // commit_status を主シグナルとする旨を明示
    const step3Idx = content.search(/^#{2,4}\s*Step\s*3\b/m);
    expect(step3Idx).toBeGreaterThanOrEqual(0);
    const step3 = extractSection(content, step3Idx);
    expect(step3).toMatch(/commit[_\s-]*status|commits\/.*\/status/i);
  });

  it("Step 6.5 で auto `@coderabbitai resolve` を chat bucket 経由で inject", () => {
    const idx = content.search(/^#{2,4}\s*Step\s*6\.5\b/m);
    expect(idx).toBeGreaterThanOrEqual(0);
    const sec = extractSection(content, idx);
    expect(sec).toMatch(/@coderabbitai\s*resolve/);
    expect(sec).toMatch(/chat\s*bucket|cr-chat|build\s*resolve/i);
    // unresolved>0 + actionable=0 の auto trigger 条件を明示
    expect(sec).toMatch(/UNRESOLVED|unresolved/);
  });

  it("Step 6.5 適用条件 3 件 AND (ACTIONABLE_LATEST=0 / UNRESOLVED>0 / cr-chat available) + injection 上限が spec 明文化 (A3/A6)", () => {
    const idx = content.search(/^#{2,4}\s*Step\s*6\.5\b/m);
    const sec = extractSection(content, idx);
    // ACTIONABLE と UNRESOLVED の strict 判定条件が明示
    expect(sec).toMatch(/ACTIONABLE_LATEST.*=.*"?0"?|ACTIONABLE_LATEST\s*=\s*"0"/);
    expect(sec).toMatch(/UNRESOLVED.*-gt.*0|UNRESOLVED\s*>\s*0/);
    // cr-chat binary availability check
    expect(sec).toMatch(/CR_CHAT_BIN|cr-chat/);
    // injection 上限 (永久 loop 防止) が明示
    expect(sec).toMatch(/RESOLVE_INJECT_COUNT|RESOLVE_INJECT_MAX|injection\s*limit/i);
  });
});

describe("caller spec enforcement (skill-bypass 防止)", () => {
  it("harness-merge-train M5 が /coderabbit-review skill 必須経由を明示 (独自 polling 禁止)", () => {
    const content = read(HARNESS_MERGE_TRAIN_PATH);
    const m5Idx = content.search(/^#{2,4}\s*M5\b/m);
    expect(m5Idx).toBeGreaterThanOrEqual(0);
    const m5 = extractSection(content, m5Idx);
    // /coderabbit-review への明示参照
    expect(m5).toMatch(/\/coderabbit-review|coderabbit-review\s+skill/);
    // 独自 polling 禁止の明示 (skill-bypass 防止)
    expect(m5).toMatch(/独自\s*polling\s*禁止|gh\s*api[\s\S]{0,80}reviews[\s\S]{0,80}禁止|skill\s*(?:必須経由|bypass\s*禁止)/i);
  });

  it("tdd-implement Phase 6 が /coderabbit-review skill 必須経由を明示", () => {
    const content = read(TDD_IMPLEMENT_PATH);
    const phase6Idx = content.search(/^#{2,4}\s*Phase\s*6\b/m);
    expect(phase6Idx).toBeGreaterThanOrEqual(0);
    const phase6 = extractSection(content, phase6Idx);
    expect(phase6).toMatch(/\/coderabbit-review|coderabbit-review\s+skill/);
    expect(phase6).toMatch(/独自\s*polling\s*禁止|skill\s*(?:必須経由|bypass\s*禁止)/i);
  });

  it("harness-work の Skill connectivity 原則 box が /coderabbit-review を含む", () => {
    const content = read(HARNESS_WORK_PATH);
    // Skill connectivity 原則 box が存在
    expect(content).toMatch(/Skill\s*connectivity\s*原則/);
    // box 配下に /coderabbit-review への明示参照と独自 polling 禁止が同居
    const boxIdx = content.search(/Skill\s*connectivity\s*原則/);
    const box = content.slice(boxIdx, boxIdx + 4000);
    expect(box).toMatch(/\/coderabbit-review|coderabbit-review/);
    expect(box).toMatch(/独自\s*polling\s*禁止|skill\s*(?:必須経由|bypass\s*禁止)/i);
  });
});

describe(".coderabbit.yaml: explicit completion signal config", () => {
  const yaml = read(CR_YAML_PATH);

  it("reviews.request_changes_workflow が true (APPROVED state 自動発火の前提)", () => {
    // YAML 構文上の `request_changes_workflow:\s*true` を厳密 match
    expect(yaml).toMatch(/^\s*request_changes_workflow:\s*true\s*$/m);
  });

  it("reviews.pre_merge_checks が宣言されている (Pre-merge gate 強制)", () => {
    // pre_merge_checks: 配下に少なくとも 1 つの check (custom_review / description_check / docstrings) が存在
    expect(yaml).toMatch(/^\s*pre_merge_checks:\s*$/m);
    // 各 check は mode: warning|error|off のいずれか
    const idx = yaml.search(/^\s*pre_merge_checks:\s*$/m);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = yaml.slice(idx, idx + 1000);
    expect(block).toMatch(/mode:\s*"?(warning|error|off)"?/);
  });
});

/**
 * Markdown header 始点 idx から、次の同 level 以下の見出しまでの section を抽出する。
 * fenced code block 内側の `# bash comment` を markdown heading と誤検知しないよう
 * code block 状態を tracking する (harness-merge-train-content.test.ts と同じ実装)。
 */
function extractSection(content: string, startIdx: number): string {
  const lines = content.slice(startIdx).split(/\r?\n/);
  if (lines.length === 0) return "";
  const headerMatch = lines[0]!.match(/^(#{2,4})\s/);
  if (!headerMatch) return lines.join("\n");
  const startLevel = headerMatch[1]!.length;
  const out: string[] = [lines[0]!];
  let inCodeBlock = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (!inCodeBlock) {
      const m = line.match(/^(#{1,4})\s/);
      if (m && m[1]!.length <= startLevel) break;
    }
    out.push(line);
  }
  return out.join("\n");
}
