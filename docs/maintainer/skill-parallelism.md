# Skill 並列性 (concurrent invocation) — 現状仕様と運用 pattern

> **Status**: documented (本 PR)
> **Owner**: harness skill layer (`plugins/harness/commands/parallel-worktree.md` etc.)
> **Source of truth**: <https://code.claude.com/docs/en/skills>, <https://code.claude.com/docs/en/sdk>

## 背景

Claude Code Skill tool は単一起動 spec で、frontmatter に `--parallel` /
`concurrency` フィールドは存在しない。複数 Skill を同時に invoke する公式
支援機構は documented されていない。

harness plugin の `/parallel-worktree` skill は内部で N 並列の worker を
fan out するが、これは Skill spec ではなく **harness 独自設計**。本 doc は
現状仕様 + 運用 pattern + 長期 design proposal を 1 箇所に固定する。

## Anthropic 公式 spec 上の事実 (一次資料 2026-04-22 確認、追加調査本 PR)

| 項目 | 状態 |
|---|---|
| Skill frontmatter `--parallel` flag | ❌ 存在しない |
| Skill frontmatter `concurrency` field | ❌ 存在しない |
| 「複数 Skill 同時 invoke」公式 documented | ❌ documented されない |
| Subagent (Agent tool) の concurrent execution | ✅ 公式 SDK で許容 (multiple Agent tool 並列起動) |
| Skill 内から Agent tool spawn | ✅ 公式 documented |
| Skill 内から別 Skill 起動 | (chain は可能、明示的な並列 chain は documented されない) |

参照:
- <https://code.claude.com/docs/en/skills>
- <https://code.claude.com/docs/en/sdk>
- <https://code.claude.com/docs/en/agent-tool> (subagent concurrent execution)

## harness `/parallel-worktree` の実装と spec 整合性

`/parallel-worktree` (`plugins/harness/commands/parallel-worktree.md`) は
Markdown 指示書として実装され、coordinator が以下の手順を実行する:

1. 各 worktree / task に対し `harness:worker` Agent tool を `run_in_background=true`
   で逐次 spawn
2. `TaskCreate` / `TaskUpdate` / `TaskList` で background job を tracking
3. 全 worker 完了後に coordinator が結果統合

**spec 整合性**:
- ✅ Agent tool 並列起動は公式 SDK で許容
- ✅ Skill 内から Agent tool spawn は公式 documented
- (warning) Skill 自体に `--parallel=N` flag を生やす機構は存在せず、
  並列度制御は Markdown 指示書側のロジックで実現 (harness 独自設計)

つまり、Skill spec から見ると `/parallel-worktree` は **コア仕組み (Agent
fan out) は spec 準拠だが、Skill レベルでの並列度宣言メカニズムは独自設計**。

## 短期 workaround (consumer 側で使うべき pattern)

Skill 内で N 並列の処理を実行したい場合:

### Pattern 1: Agent tool 並列 fan out (推奨、harness 独自設計)

```markdown
<!-- skill.md -->
You are a coordinator. For each task, spawn a `harness:worker` Agent tool
with `run_in_background=true`. After all workers complete, integrate results.

Steps:
1. List tasks to dispatch
2. For each task: spawn Agent (background)
3. Wait for completion (TaskList polling)
4. Integrate
```

`/parallel-worktree` がこの pattern を採用する。N 並列の上限は
coordinator が手動で制御 (固定値 or skill argument)。

### Pattern 2: 単一 Skill 連続 invocation (fallback)

3 Track の review を並列で行いたい case:

```bash
/my-skill review-1   # 1 つ目
/my-skill review-2   # 2 つ目
/my-skill review-3   # 3 つ目
```

Skill 起動は逐次。並列性が要件なら Agent tool fan out (Pattern 1) を使う。

## 長期 design proposal (Anthropic 公式提案 draft)

以下を Anthropic 公式 (`https://github.com/anthropics/claude-code/issues`)
に Feature request label 付きで提出する。

### Title

`[Feature] Skill frontmatter: --parallel=N flag for concurrent skill invocation`

### Body draft

````markdown
## Summary

Currently Claude Code Skills do not have a documented mechanism for
concurrent invocation. Plugin authors who want to fan out N parallel
sub-tasks must implement orchestration in the Markdown skill body using
Agent tool spawns. We propose adding a frontmatter field
`parallelism: N` (or `--parallel=N` argument) to declare
"this skill expects to run up to N concurrent sub-invocations."

## Motivation

Plugins like `harness:parallel-worktree` orchestrate N parallel TDD workers
across separate git worktrees. Today the parallelism is opaque to:
- Skill consumers (who read the skill description)
- Claude Code's resource accounting (which sees only the outer Skill)
- Other tools that might want to enforce concurrency budgets

Surface-level `parallelism` declaration would let Claude Code:
- Display "[parallel up to N]" in skill listings
- Enforce per-skill concurrency budgets
- Allow consumers to tune parallelism via skill arguments

## Proposed API

Frontmatter:

```yaml
---
name: parallel-worktree
parallelism: 3      # default upper bound
---
```

Argument override:

`/parallel-worktree --parallel=5`

## Backward compatibility

- Plugins that omit `parallelism` field behave as today (single-invocation)
- Plugins that declare `parallelism: 1` are explicitly single
- Existing N-parallel plugins (like `/parallel-worktree`) declare
  `parallelism: N` to make their behavior explicit

## Alternative considered

- Native concurrent skill chains (`/skill-a && /skill-b parallel`) — too
  intrusive, breaks existing skill semantics
- SDK-level fan out only — requires plugin authors to drop down to TS/JS,
  reduces accessibility
````

## Reference

- 公式 Skills docs: <https://code.claude.com/docs/en/skills>
- 公式 SDK docs: <https://code.claude.com/docs/en/sdk>
- 公式 Agent tool docs: <https://code.claude.com/docs/en/agent-tool>
- harness `/parallel-worktree` 実装: `plugins/harness/commands/parallel-worktree.md`
- gen-20 申送 (skill 並列性問題の発端): `.docs/handoff/archive/session-2026-04-27-gen20-3track-anthropic-spec-followup.md`
- 本 PR Track C 調査結果: 本 doc 作成 session
