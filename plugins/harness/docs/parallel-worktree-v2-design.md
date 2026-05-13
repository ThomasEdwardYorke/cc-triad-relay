# `parallel-worktree` v2 — Model B Architecture Design

> **Status**: Stage A design doc (not yet shipped as a slash command).
> Stages B–D (tmux template + session manager + claude-oneshot skill)
> are prerequisites. v1 (`commands/parallel-worktree.md`) remains in
> production until v2 is fully implemented.
> **Owner**: harness core
> **Reference**: `docs/maintainer/ROADMAP-model-b.md` Phase 2

## Why v2

v1 is **Model A**: a single `claude` process orchestrates `Agent`-tool
subagents that share its context. While effective for small parallel work
(2-3 subtasks), Model A has structural ceilings:

1. **Subagent context overflow**: 3+ long-running parallel subagents (Codex
   reviews, complex implementations) saturate the parent claude's working
   memory. Loss-of-result + 100% timeout is reproducible at high parallelism.
2. **Skill tool unavailable inside subagents**: `harness:worker` runs without
   `Skill` tool, so `/pseudo-coderabbit-loop`, `/coderabbit-review`, and
   `/codex-team` cannot be invoked from inside a worker. The coordinator
   has to run those phases sequentially after all workers finish.
3. **No top-level autonomy per worktree**: each worker is a dependent
   subagent, so it cannot fork its own subagents (OOM risk per Anthropic
   issue #19077).

**Model B** dissolves these limits by giving each worktree its own
top-level `claude` process. Every worktree is an autonomous session that
can use the full skill catalog, run its own Agent/Codex subagents, and
report back via git progress and optional stream-json logs without burdening
any sibling.

## Architecture

```text
+--------------------------------------------------------------+
| coordinator session (this skill, v2)                         |
|  - tmux session manager (orchestrates N windows)             |
|  - progress monitor (reads git log + optional stream-json)   |
|  - merge-train integration (post-completion phase 8)         |
+-------+----------------------+----------------------+--------+
        |                      |                      |
        v                      v                      v
+---------------+      +---------------+      +---------------+
| tmux window 1 |      | tmux window 2 |      | tmux window N |
| claude -n A   |      | claude -n B   |      | claude -n N   |
| /tdd-implement|      | /tdd-implement|      | /tdd-implement|
|   Phase 1-7   |      |   Phase 1-7   |      |   Phase 1-7   |
+---------------+      +---------------+      +---------------+
        |                      |                      |
        +----- worktree A ----+----- worktree B ----+--- worktree N
              (sibling repo + ~/.claude/ overlay shared)
```

### Process model

| layer            | v1 (Model A)                            | v2 (Model B)                                          |
|------------------|-----------------------------------------|-------------------------------------------------------|
| coordinator      | the running claude session              | a tmux session controller (post-completion merge train, no Claude reasoning loop during workers running) |
| per-worktree     | `Agent`-tool subagent (`harness:worker`)| **independent `claude -n <slug>` process**            |
| harness inheritance | shared from coordinator context     | each worktree inherits user-level `~/.claude/` overlay |
| skill access     | restricted (no Skill / no Agent for worker) | full access (skills, agents, MCP) per worktree    |
| context budget   | shared with coordinator                  | each worktree has its own 1 M context budget          |
| progress         | TaskList + worker prompt return value    | git commit log + optional stream-json per worktree    |
| phase 5.5 / 6 / 7| coordinator-only, after all workers finish | each worktree runs them inside its own claude session |
| phase 8 (merge)  | coordinator                              | coordinator (`/harness-merge-train` after all sessions complete) |

### Inheritance: how each worktree gets the full harness

Anthropic's `claude --worktree` (2.1.49) creates `<repo>/.claude/worktrees/`
subdirs that **do not inherit `.claude/skills` / `.claude/agents` /
`.claude/rules`** ([issue #28041](https://github.com/anthropics/claude-code/issues/28041)).
That is incompatible with Model B because each worktree must run the
same harness stack as the coordinator.

**Workaround (sibling worktree pattern, used since v1)**:

```bash
git worktree add "../<project>-wt-<slug>" -b "<feature>-<slug>" "<feature>"
```

Sibling worktrees inherit the user's `~/.claude/` (skills / commands /
agents) automatically — that's how the harness plugin reaches every
worktree without per-worktree copy. Project-level `.claude/` is empty in
the new sibling, but project rules can be imported via `CLAUDE.md`'s
`@import` syntax pointing back to the main repo (or copied if the worker
needs to write to them).

## v2 entry point

```bash
/parallel-worktree-v2 <spec.json>
```

Spec format (additive over v1):

```json
{
  "feature_branch": "main",
  "base_dir": "/path/to/main/repo",
  "worktree_parent_dir": "/path/to/main/repo/..",
  "worktree_prefix": "my-project-wt-",
  "tmux_session_name": "harness-parallel",
  "claude_per_session_options": {
    "model": "claude-opus-4-7",
    "permission_mode": "acceptEdits",
    "output_format": "stream-json"
  },
  "sub_tasks": [
    {
      "slug": "frontend",
      "work_item_label": "frontend-work",
      "title": "...",
      "owned_files": ["frontend/**"],
      "merge_priority": 4
    }
  ]
}
```

The new `tmux_session_name` and `claude_per_session_options` fields
distinguish v2 from v1. v1 specs without those fields trigger a
deprecation warning and route to v1's Agent-tool path (back-compat
fallback during migration). The `work_item_label` field replaces v1's
`task_id` shape — consumer projects may map their own internal ticket
IDs to this neutral label at spec-build time.

## Phase chain

| Phase | v1 (Model A)                          | v2 (Model B)                                     |
|-------|----------------------------------------|--------------------------------------------------|
| 0     | Pre-flight (overlap detection, config)| same                                             |
| 1     | `git worktree add` per task           | same + `tmux new-session -d -s <name>`           |
| 2     | dispatch `harness:worker` subagent    | **`tmux new-window` + `claude -n <slug> /tdd-implement <T-N> --profile=<P>`** |
| 3-5   | worker runs Red→Green→Refactor + Codex| **each claude session runs Phase 1-5 itself**    |
| 5.5   | coordinator runs `/pseudo-coderabbit-loop` after all workers finish | **each worktree runs Phase 5.5 inside its own claude session** |
| 6     | coordinator runs `/coderabbit-review`  | **each worktree runs `/coderabbit-review` post-push, in parallel** |
| 7     | coordinator runs `/codex-team` adversarial | **each worktree runs Phase 7 internally**       |
| 8     | coordinator merges PRs (merge train)  | **coordinator runs `/harness-merge-train` after all sessions complete** |

The key architectural shift is that **Phases 5.5/6/7 move from
coordinator-only to per-worktree** — each independent claude session
runs the full quality gate chain on its own PR.

## Progress monitoring

Interactive `claude -n <slug>` sessions are monitored through git commit
timestamps; headless / mock flows may also write
`/tmp/claude-log-<slug>.jsonl` stream-json output. The coordinator runs a
**session-manager** (`session-manager.ts`, Stage C) that aggregates:

- per-window git commit log (which slug landed which commit when)
- per-window stream-json tool calls (current Phase, last tool used)
- per-window phase markers (`Phase 5 GREEN reached`, `Phase 5.5 actionable=0`)
- per-window idle age from the latest parsed stream-json event timestamp,
  falling back to the latest git commit timestamp when no event stream exists

Aggregator output is rendered to a single coordinator dashboard:

```text
[harness-parallel] tmux session — 4 windows, 4 sub-tasks

  | slug      | branch              | phase | last commit          | status |
  |-----------|---------------------|-------|----------------------|--------|
  | frontend  | feature/main-fe     | 5.5   | a1b2c3d 2 min ago    | actionable=0, Pseudo CR clean |
  | backend   | feature/main-be     | 5     | e4f5g6h 11 min ago   | running (WARN-idle 11m) |
  | shared    | feature/main-shared | 7     | i7j8k9l 12 min ago   | Codex Phase 7 SHIP |
  | docs      | feature/main-docs   | 8     | m0n1o2p 18 min ago   | merged ✓ |
```

## Inter-worktree coordination

v2 inherits v1's `detectOverlap()` static analyzer for `owned_files` /
`forbidden_files` declarations (Phase 0 pre-flight). The new addition
is **dynamic conflict detection during merge train**: as each PR merges,
later PRs receive a rebase notification with conflict ranges — handled
by the existing `/harness-merge-train` skill.

## Migration from v1

| stage  | timing                       | action                                                                    |
|--------|------------------------------|---------------------------------------------------------------------------|
| 1      | Stage B lands (tmux template)| v1 unchanged; `parallel-sessions-template.sh` ships in `scripts/`         |
| 2      | Stage C lands (session-manager) | v1 unchanged; coordinator can attach session-manager to v1 runs as opt-in |
| 3      | Stage D lands (claude-oneshot)  | v1 unchanged; oneshot skill becomes available as primitive             |
| 4      | Stage A v2 doc → ship           | v2 ships as `parallel-worktree-v2.md` skill; v1 remains as default     |
| 5      | First real-world pilot          | first multi-task batch from a real-world pilot project uses v2         |
| 6      | A/B data confirms               | v2 promoted to default; v1 marked deprecated                            |
| 7      | Main merge                      | v2 replaces v1 in shipped plugin                                        |

This staged migration keeps v1 working through every stage and avoids
the anti-pattern of replacing production code with un-validated
infrastructure.

## Open design questions

- **stream-json filter**: how does session-manager deduplicate noisy
  tool-use lines (every Read / Bash) into phase-level signal? Probably
  match against `tool_name == "TaskUpdate"` for explicit phase markers
  + commit-log polling for Phase 5/6/7/8 transitions.
- **tmux pane vs window**: 1 window per worktree is the simplest mental
  model, but pane-split layouts let the operator see all 4 worktrees
  on one screen. Default = window per worktree, opt-in pane split via
  `tmux_pane_layout: "tiled"` field.
- **`claude -n <slug>` session lifecycle**: when a worktree's PR
  is merged, the session can exit cleanly. But during rebase conflict
  resolution, the operator may need to re-attach. Plan: provide a
  `/parallel-worktree-v2 attach <slug>` subcommand that runs
  `tmux attach-session -t <session> ; tmux select-window -t <slug>`.
- **Failure recovery**: if a worktree's claude session crashes mid-task,
  session-manager should detect (last-event timestamp > 10 min, or latest
  commit timestamp when no event stream exists) and prompt the operator.
  Specifically, what auto-restart vs human-in-the-loop
  policy? Default: alert only, no auto-restart (Anthropic responsible-AI
  guidance leans toward operator confirmation for autonomous restarts).

## Implementation stages (Phase 2 breakdown)

| stage    | deliverable                                                         | status          |
|----------|---------------------------------------------------------------------|-----------------|
| Stage A  | This design doc                                                     | draft (this PR) |
| Stage B  | `plugins/harness/scripts/parallel-sessions-template.sh`             | pending         |
| Stage C  | `plugins/harness/core/src/session-manager.ts` + tests               | pending         |
| Stage D  | `plugins/harness/commands/claude-oneshot.md`                        | pending         |
| Stage E  | `plugins/harness/commands/parallel-worktree-v2.md` (replaces v1)    | pending         |
| Stage F  | content-integrity tests for v2 + migration warning in v1            | pending         |
| Stage G  | smoke test: 2-window tmux + claude -n + completion detection         | shipped         |

The maintainer-facing roadmap (`docs/maintainer/ROADMAP-model-b.md`) tracks
the same stages under Phase 2 numbering for cross-reference; the neutral
labels above are used in this shipped doc to keep the spec generic.

## References

- v1 spec: `plugins/harness/commands/parallel-worktree.md`
- ROADMAP: `docs/maintainer/ROADMAP-model-b.md` Phase 2
- Anthropic worktree issue: <https://github.com/anthropics/claude-code/issues/28041>
- Anthropic nested-subagent OOM: <https://github.com/anthropics/claude-code/issues/19077>
- Related external work: [workmux](https://github.com/raine/workmux), [Codeman](https://github.com/Ark0N/Codeman)
