/**
 * core/src/__tests__/clarify-content.test.ts
 *
 * `/harness:clarify` command (旧 grill-me / 個人 skill から plugin 取込) の
 * コンテンツ不変条件 (strict pre-parse regression).
 *
 * 目的:
 *   clarify command の絶対原則 7「具体例 + 二重表現」 (audience-aware
 *   double-expression rule) が後続 PR で silently 削除 / 弱体化されないように、
 *   prompt 上の構造的契約を CI 時点で強制する。第 7 原則は「初学者・ベテラン両層に
 *   届く言葉で問う」ための最低保証であり、この欠落は clarify が用語のみ /
 *   業務影響のみの片肺質問に逆戻りすることを意味する。
 *
 * 対応する harness 機能:
 *   - commands/clarify.md § 絶対原則 7
 *   - schemas/harness.config.schema.json clarify オブジェクト
 *
 * 期待 (高水準):
 *   1. frontmatter 5 field (name / description / description-ja / allowed-tools / argument-hint) 完備
 *   2. legacy trigger `grill me` / `/grill-me` が description / description-ja に保持
 *   3. 絶対原則 7 「具体例 + 二重表現」 section が存在
 *   4. description テンプレ「ベテラン: / 初学者: / 例:」が存在 (3 行構造)
 *   5. Bad / Good 対比例が prompt 内にある (用語のみ ❌ / 業務影響のみ ❌ / 二重表現 ✅)
 *   6. harness.config.json schema に clarify.audienceLevel / includeConcreteExamples / exampleCount が宣言済
 *   7. AskUserQuestion 経由が absolute (plain text 質問禁止) として残っている
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, "../../..");

function readCommand(name: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, "commands", `${name}.md`), "utf-8");
}

function extractFrontmatter(md: string): string {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error("frontmatter not found");
  return m[1];
}

describe("clarify command: frontmatter 5-field 完備 (description-ja は新規 ship のため必須)", () => {
  const content = readCommand("clarify");
  const fm = parseYaml(extractFrontmatter(content)) as Record<string, unknown>;

  it("name === 'clarify'", () => {
    expect(fm.name).toBe("clarify");
  });

  it("description が 200 char 以上の英文 (skill discoverability)", () => {
    expect(typeof fm.description).toBe("string");
    expect((fm.description as string).length).toBeGreaterThan(200);
  });

  it("description-ja が必須 (新規 ship、legacy 例外なし)", () => {
    expect(typeof fm["description-ja"]).toBe("string");
    expect((fm["description-ja"] as string).length).toBeGreaterThan(50);
  });

  it("allowed-tools に AskUserQuestion / Read / Grep / Glob / Bash / ToolSearch / Write が含まれる + extra なし (size===7)", () => {
    const tools = fm["allowed-tools"];
    expect(Array.isArray(tools)).toBe(true);
    const set = new Set(tools as string[]);
    // ToolSearch は body の AskUserQuestion fallback ロジック (`ToolSearch query="select:AskUserQuestion"`)
    // を allowed-tools 側で許可するために必須。frontmatter から外すと body の自己整合性が崩れる。
    for (const required of ["Read", "Grep", "Glob", "Bash", "AskUserQuestion", "ToolSearch", "Write"]) {
      expect(set.has(required), `allowed-tools missing ${required}`).toBe(true);
    }
    // size 検証: Agent / Monitor 等の extra tool が accidentally 追加された場合に regression を
    // 捉える。clarify は depth-first interview に必要な 7 tool で機能上完結する。新たに tool
    // が必要になった時はこの test と SKILL.md 第 7 原則を同時に update する規律を強制。
    expect(set.size).toBe(7);
  });

  it("argument-hint が定義済", () => {
    expect(typeof fm["argument-hint"]).toBe("string");
    expect((fm["argument-hint"] as string).length).toBeGreaterThan(0);
  });
});

describe("clarify command: legacy trigger 互換 (`grill me` / `/grill-me` は description で永続的に維持)", () => {
  const content = readCommand("clarify");
  const fm = parseYaml(extractFrontmatter(content)) as Record<string, unknown>;

  it("description-ja に `grill me` と `/grill-me` (legacy trigger) が記載", () => {
    const ja = fm["description-ja"] as string;
    // 既存 user の muscle memory を温存するため legacy trigger を ship 時点から
    // description に明示。これを CI で fixate しないと、後続 PR で「unused」と
    // 判断され silently 削除されるリスクがある。
    expect(ja).toMatch(/grill me/);
    expect(ja).toMatch(/\/grill-me/);
  });

  it("legacy trigger が `legacy` ラベル付きで co-located されている (split deprecation 防止)", () => {
    const ja = fm["description-ja"] as string;
    // CR Codex review (Nitpick 3): grill me と /grill-me が「legacy trigger」の
    // ラベルと同じ context で記載されていることを保証。後続 PR で legacy trigger を
    // 別の deprecation notice section に移動した場合、独立 grep test は通り続けるが
    // user-facing description で legacy 性が失われる regression が起きうる。
    // 「legacy trigger」 label が両 trigger と同 description 内に存在することを
    // 強制し、機能としての連続性を CI で fixate。
    expect(ja).toMatch(/grill me[\s\S]{0,50}legacy[\s_-]*trigger|legacy[\s_-]*trigger[\s\S]{0,50}grill me/i);
  });

  it("description (英) にも legacy trigger が記載 (English-speaking user discovery)", () => {
    const en = fm.description as string;
    expect(en).toMatch(/grill[- ]?me/i);
  });
});

describe("clarify command: 絶対原則 7 「具体例 + 二重表現」 — 初学者・ベテラン両層 (audience-aware double-expression rule)", () => {
  const content = readCommand("clarify");

  it("第 7 原則 section が body に存在 (`絶対原則` 配下、見出し 7)", () => {
    // 第 1〜6 までは個人 skill 由来、第 7 は plugin 取込時の新規追加。
    // この見出しを CI で固定しないと、後続 PR で「冗長」と判断され
    // silently 削除されるリスクがある (audience-aware double-expression rule
    // は plugin 取込時の核心要件)。
    expect(content).toMatch(/7\.\s*\*\*具体例\s*\+\s*二重表現/);
  });

  it("3 要素併記契約 (a) ベテラン技術用語結論 / (b) 初学者業務影響 / (c) 具体例 1 つ — が明示", () => {
    // 第 7 原則の核心は「3 要素を必ず併記」。これを CI で 3 要素全てが
    // 文字列として現れることで fixate (1 つでも欠落したら fail)。
    expect(content).toMatch(/\(a\)[\s\S]{0,80}ベテラン/);
    expect(content).toMatch(/\(b\)[\s\S]{0,80}初学者/);
    expect(content).toMatch(/\(c\)[\s\S]{0,80}具体例/);
  });

  it("`description` テンプレ「ベテラン: / 初学者: / 例:」 3 行構造が prompt 内に存在", () => {
    // option `description` 1〜3 文の枠内で 3 要素を 3 行で配分する
    // テンプレ。実装者が clarify を起動したとき、このテンプレが prompt 内に
    // 存在しないと AskUserQuestion option が用語のみの片肺出力に戻る。
    expect(content).toMatch(/ベテラン:\s*<?技術用語結論>?/);
    expect(content).toMatch(/初学者:\s*<?業務影響/);
    expect(content).toMatch(/例:\s*<?具体例>?/);
  });

  it("Bad / Good 対比例 が body に存在 (用語のみ ❌ / 業務影響のみ ❌ / 二重表現 ✅)", () => {
    // 抽象的な原則だけでは prompt の解釈ブレが発生する。Bad / Good 例を
    // body 内に持つことで、agent が起動時に「自分の出力が Bad に該当
    // しないか」を self-check できる。
    expect(content).toMatch(/❌[\s\S]{0,200}用語のみ/);
    expect(content).toMatch(/❌[\s\S]{0,400}業務影響のみ/);
    expect(content).toMatch(/✅[\s\S]{0,400}二重表現/);
  });

  it("`harness.config.json.clarify.*` 設定への参照が body 内にある", () => {
    // 設定 audienceLevel / includeConcreteExamples / exampleCount を
    // 知らないユーザーが第 7 原則を override できるよう、body に
    // 設定キー名が文字列で存在することを保証。
    expect(content).toMatch(/harness\.config\.json[\s\S]{0,80}clarify/);
    expect(content).toMatch(/audienceLevel/);
    expect(content).toMatch(/includeConcreteExamples/);
    expect(content).toMatch(/exampleCount/);
  });
});

describe("clarify command: AskUserQuestion 経由必須 + 1-呼出-1-question 契約 (depth-first 原則)", () => {
  const content = readCommand("clarify");

  it("plain text 質問禁止 ルールが body に存在", () => {
    // 個人 skill 由来の絶対原則 6。plugin 取込で消えない CI 保証。
    expect(content).toMatch(
      /plain[\s_-]*text[\s\S]{0,200}(?:禁止|してはいけない|不可|throw|forbid)/i,
    );
  });

  it("1 呼出 = 1 question (バッチ禁止) ルールが body に存在", () => {
    expect(content).toMatch(/1\s*呼出[\s\S]{0,40}1\s*question/);
  });

  it("やってはいけないこと section に絶対原則 7 違反 (用語のみ / 業務影響のみ / 例なし) が明示", () => {
    // 第 7 原則を「やってはいけない」 section にも明記し、二重に強制する。
    expect(content).toMatch(/絶対原則\s*7\s*を破る/);
  });
});

describe("harness.config.json schema: clarify config 宣言 (audience-aware double-expression rule)", () => {
  const schemaPath = resolve(PLUGIN_ROOT, "schemas/harness.config.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
    properties: Record<string, unknown>;
  };

  it("`clarify` プロパティが top-level properties に存在", () => {
    expect(schema.properties).toHaveProperty("clarify");
  });

  it("clarify.audienceLevel が enum [beginner | senior | both]、default 'both'", () => {
    const clarify = schema.properties.clarify as {
      properties: Record<string, unknown>;
    };
    const audience = clarify.properties.audienceLevel as {
      enum: string[];
      default: string;
    };
    expect(audience.enum.slice().sort()).toEqual(["beginner", "both", "senior"]);
    expect(audience.default).toBe("both");
  });

  it("clarify.includeConcreteExamples が boolean、default true", () => {
    const clarify = schema.properties.clarify as {
      properties: Record<string, unknown>;
    };
    const incl = clarify.properties.includeConcreteExamples as {
      type: string;
      default: boolean;
    };
    expect(incl.type).toBe("boolean");
    expect(incl.default).toBe(true);
  });

  it("clarify.exampleCount が integer、minimum 1 / maximum 3 / default 1", () => {
    const clarify = schema.properties.clarify as {
      properties: Record<string, unknown>;
    };
    const ex = clarify.properties.exampleCount as {
      type: string;
      minimum: number;
      maximum: number;
      default: number;
    };
    expect(ex.type).toBe("integer");
    expect(ex.minimum).toBe(1);
    expect(ex.maximum).toBe(3);
    expect(ex.default).toBe(1);
  });

  it("clarify オブジェクトが additionalProperties: false (typo / 未知キー検出)", () => {
    const clarify = schema.properties.clarify as {
      additionalProperties: boolean;
    };
    expect(clarify.additionalProperties).toBe(false);
  });

  it("clarify オブジェクトが required: [] を明示宣言 (default 適用条件の drift 防止)", () => {
    // CR Round 1 inline: schema が `required` を省略すると JSON Schema 仕様上は
    // `required: []` と等価だが、後続 PR で `required: ["audienceLevel"]` 等が
    // 追加された場合に「全 key optional」契約が壊れる。明示的に `required: []`
    // が宣言されていることを CI で fixate し、この契約変更には test 同時更新を強制する。
    const clarify = schema.properties.clarify as {
      required?: string[];
    };
    expect(Array.isArray(clarify.required), "clarify.required must be an array").toBe(true);
    expect(clarify.required).toEqual([]);
  });
});
