---
name: parallel-worktree-v2
description: "Model B parallel TDD orchestrator. Each worktree runs an independent top-level claude process inside a dedicated tmux window, and each process executes the full /tdd-implement Phase 1-7 loop on its own. The coordinator session only handles worktree creation, tmux orchestration, progress aggregation, and the post-completion merge train. Use when 3+ independent sub-tasks need true per-worktree skill access (Pseudo CR + Real CR + Codex Phase 7 each) without context contention. The legacy /parallel-worktree (Model A) coexists for 2-3 sub-task batches and stable subagent flows."
description-ja: "Model B 並列 TDD オーケストレータ (v2)。各 worktree で独立した top-level claude プロセスを tmux 上に起動し、それぞれが内部で /tdd-implement Phase 1-7 を完全実行する。coordinator は worktree 生成 / tmux 管理 / 進捗 aggregation / merge train (Phase 8) のみ担当。3 以上の独立 sub-task で per-worktree に Pseudo CR + Real CR + Codex Phase 7 を並列実行したい場合に使用。legacy `/parallel-worktree` (Model A) は 2-3 件 / stable subagent flow 向けに並存。"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput", "Monitor"]
argument-hint: "[spec|feature-branch|max-parallel|tmux-session|profile|attach|status|stop|dry-run|no-commit]"
---

# `/parallel-worktree-v2` — Model B parallel TDD orchestrator (v2)

## Execution model — Model B

This skill operates in **Model B**: each worktree runs an **independent
top-level claude process** inside a dedicated tmux window.

```text
+-----------------------------------------------------------------+
| coordinator session (this skill, runs once)                     |
|  - tmux session controller (launch / status / attach / stop)    |
|  - progress aggregator (session-manager dashboard)              |
|  - merge train orchestrator (Phase 8: /harness-merge-train)     |
+-------+----------------------+----------------------+-----------+
        |                      |                      |
        v                      v                      v
+---------------+      +---------------+      +---------------+
| tmux window 1 |      | tmux window 2 |      | tmux window N |
| claude -n A   |      | claude -n B   |      | claude -n N   |
| /tdd-implement|      | /tdd-implement|      | /tdd-implement|
|  Phase 1-7    |      |  Phase 1-7    |      |  Phase 1-7    |
+---------------+      +---------------+      +---------------+
        |                      |                      |
   worktree A             worktree B             worktree N
   (sibling repo + ~/.claude/ overlay shared automatically)
```

- **coordinator** is the parent claude session that runs this skill. It
  orchestrates only.
- **per-worktree claude** is a **fully independent** top-level claude
  process. Each has full `Skill` / `Agent` tool access, can spawn its own
  Codex / Pseudo CR / Real CR subagents, and runs in its own context budget.
- Per-worktree claude processes do **not** share parent context (1M
  context budget per worktree).

### Comparison with Model A (legacy `/parallel-worktree`)

| layer            | Model A (legacy)                                 | Model B (this skill)                                                    |
|------------------|---------------------------------------------------|-------------------------------------------------------------------------|
| coordinator      | parent claude session                             | parent claude session (orchestration only while workers run)            |
| per-worktree     | `Agent`-tool subagent (`harness:worker`)          | **independent top-level `claude` process** in a tmux window             |
| harness loading  | shared from coordinator context                   | each worktree loads user-level `~/.claude/` overlay independently       |
| skill access     | restricted (subagents cannot use `Skill` tool)    | full (skills / agents / MCP / hooks all available)                      |
| context budget   | shared with coordinator                           | each worktree has its **own context budget**                            |
| Phase 5.5/6/7    | coordinator runs them after all workers finish    | **each worktree runs them itself** (Pseudo CR / Real CR / Codex Phase 7)|
| Phase 8 (merge)  | coordinator (`/harness-merge-train`)              | coordinator (`/harness-merge-train`, same)                              |
| high parallelism | 3+ saturates parent context / subagent OOM risk   | each worktree is autonomous; scales to many parallel tasks              |

**When to use Model A**: 2-3 small parallel sub-tasks, short runtime,
subagent-friendly workload.
**When to use Model B**: 3+ parallel sub-tasks, long-running TDD per task,
need per-worktree quality gates (Pseudo CR / Real CR / Codex Phase 7),
parent claude needs to remain responsive for other work.

---

## Required primitives

This skill depends on three companion primitives shipped with the harness:

| primitive | path | role |
|---|---|---|
| tmux launcher script | `plugins/harness/scripts/parallel-sessions-template.sh` | `start N <slugs>` creates N worktrees + N tmux windows + N independent claude sessions |
| progress aggregator | `plugins/harness/core/src/session-manager.ts` | reads each worktree's git log + optional stream-json logs and renders a single coordinator dashboard |
| headless one-shot wrapper | `plugins/harness/commands/claude-oneshot.md` | wraps `claude -p <instruction> --output-format stream-json`; useful when a worktree needs a deterministic non-interactive task with a structured event stream |

All three primitives must be present in the installed plugin tree before
this skill starts. Pre-flight (Phase 0) verifies their existence.

---

## Operating principles

1. **TDD + Codex run inside each worktree**: per-worktree claude executes
   `/tdd-implement` v2 Phase 1-7. Coordinator focuses on orchestration.
2. **Phase 5.5 / 6 / 7 are per-worktree responsibilities**: Pseudo CR /
   Real CR / Codex adversarial review run inside each independent claude
   session, not in the coordinator.
3. **Coordinator stays thin**: worktree creation, tmux session, dashboard
   aggregation, merge train. The coordinator does not hold an active
   reasoning loop while workers run.
4. **No quality-gate skipping**: Model B's whole point is removing the
   structural reasons for skipping Phases (subagent context limits, skill
   tool unavailability). All gates remain mandatory.
5. **Generic skill**: usable by any project. Project-specific config
   (`.coderabbit.yaml`, `CLAUDE.md`, etc.) is inherited automatically by
   each worktree.
6. **Anthropic CLI compliance**:
   - `claude -n <name>` sets the **interactive session display name only**
     — it does not enable headless output and does not resume a session.
     A new interactive session is started in the tmux window; the operator
     can attach and use the REPL.
   - Session resume uses `claude -r <session-id>` or `--resume <name>`.
   - **Headless one-shot** (with `--output-format stream-json`) uses
     `claude -p '<prompt>' --output-format stream-json` and is delegated
     to the `claude-oneshot` primitive when stream-json output is needed.

---

## Input format

### Option A: `--spec=<json-file>`

```json
{
  "feature_branch": "main",
  "base_dir": "/path/to/project",
  "worktree_parent_dir": "/path/to/project/..",
  "worktree_prefix": "myproject-wt-",
  "tmux_session_name": "harness-parallel",
  "claude_per_session_options": {
    "model": "claude-opus-4-7",
    "permission_mode": "acceptEdits",
    "log_dir": "/tmp"
  },
  "sub_tasks": [
    {
      "slug": "frontend",
      "work_item_label": "frontend-work",
      "title": "frontend foundation scaffold",
      "description": "...",
      "acceptance_criteria": ["..."],
      "owned_files": ["src/frontend/**"],
      "forbidden_files": ["pyproject.toml", "src/backend/*"],
      "depends_on": [],
      "merge_priority": 4
    }
  ]
}
```

Fields specific to v2:

- `tmux_session_name` (required): name passed to `tmux new-session`. If a
  session with that name exists the launcher attaches; otherwise it
  creates a fresh one.
- `claude_per_session_options` (required): per-window `claude` invocation
  options. The `log_dir` field tells session-manager where to expect any
  stream-json logs produced by `claude-oneshot` invocations.
- `work_item_label`: project-neutral label replacing internal tracker IDs.
  Consumer projects map their own ticket IDs to this field at spec-build
  time so the shipped skill stays portable.

### Option B: positional arguments

```text
/parallel-worktree-v2 <feature-branch> <slug1> <slug2> ... [--profile=<chill|assertive|strict>] [--max-parallel=N] [--dry-run] [--no-commit]
```

`--max-parallel=N` caps concurrent tmux windows (default = number of
sub-tasks). When N is below the sub-task count, the coordinator dispatches
the remaining sub-tasks as earlier windows finish (semaphore-style).
Slug values must match `^[A-Za-z_][A-Za-z0-9_-]*$`; dots are intentionally
rejected because tmux target syntax treats `.` as the window/pane separator,
and leading digits are rejected because tmux tries numeric window indexes
before exact window names.

### Subcommands

```text
/parallel-worktree-v2 status            # phase / latest commit / status per window
/parallel-worktree-v2 attach <slug>     # tmux attach to the window for <slug>
/parallel-worktree-v2 stop [--rollback] # stop all sessions; --rollback also removes worktrees
/parallel-worktree-v2 verify [<slug>...] # re-run skill-registry probe + escalate
```

The `verify` subcommand re-runs the harness skill-registry probe against a
running tmux session and re-injects the 8-field BLOCKED escalation prompt
into any worker whose registry is incomplete. This is the operator-driven
**repush path** for the overlay-load race (see Phase 0 + Phase 1
Skill registry verify section below).

Example invocations:

```bash
# probe every non-coordinator window in the session
./plugins/harness/scripts/parallel-sessions-template.sh verify harness-parallel

# probe a specific subset of slugs
./plugins/harness/scripts/parallel-sessions-template.sh verify harness-parallel frontend backend

# probe + escalate, but skip the BLOCKED-prompt injection
CLAUDE_SKILL_VERIFY_ESCALATE=0 \
  ./plugins/harness/scripts/parallel-sessions-template.sh verify harness-parallel
```

---

## Phase 0 — pre-flight

Seven checks must pass before any worktree is created:

1. `feature_branch` exists locally and the working tree is clean.
2. No worktree path collision and no tmux session name collision.
3. `owned_files` / `forbidden_files` static overlap analysis (`detectOverlap()`,
   shared with the legacy v1 skill).
4. `depends_on` graph is a DAG (topological sort succeeds).
5. Codex CLI is reachable and authenticated (`codex --version`).
6. The three required primitives exist in the installed plugin tree.
7. The active task tracker (Plans.md or handoff backlog) records each
   new sub-task with `status=in_progress`.

If any check fails, run `--dry-run` first and resolve the issue before
the real launch.

---

## Phase 1 — tmux session and worktree creation

The coordinator delegates the actual launch to the template script. The
script takes positional args (`start <feature_branch> <slug1> [slug2 ...]`)
and reads tunables from env vars:

```bash
TMUX_SESSION_NAME="${TMUX_SESSION_NAME}" \
WORKTREE_PARENT_DIR="${WORKTREE_PARENT_DIR}" \
CLAUDE_MODEL="${MODEL}" \
CLAUDE_PERMISSION_MODE="${PERM}" \
bash plugins/harness/scripts/parallel-sessions-template.sh start \
     "${FEATURE_BRANCH}" "${SLUG_LIST[@]}"
```

The script:

- creates a detached tmux session,
- adds one git worktree per slug (`git worktree add ../<prefix><slug> -b feature/<feature>-<slug> <feature_branch>`),
- opens one tmux window per slug and starts an **interactive** `claude` in
  it: `tmux new-window -n "$slug" "cd <wt> && claude -n <slug> <model_flag> --permission-mode <perm>"`.

`claude -n <slug>` sets the interactive session display name only. The
operator can attach to the tmux session and use the REPL normally.

### tmux env propagation (`-e KEY=VAL`)

By default `tmux new-session` filters out custom env vars on session
creation, so the per-window `claude` cannot see env the coordinator set.
The launcher always forwards the harness's well-known log-path env to the
new tmux session and accepts an operator-defined whitelist for the rest:

| env var                  | propagation                                                                |
|--------------------------|----------------------------------------------------------------------------|
| `CLAUDE_ONESHOT_LOG_DIR` | always forwarded when set (session-manager log-path convention)            |
| `TMUX_PASS_ENV`          | whitespace-separated list of additional env var **names** to forward       |

Both names and values are validated to reject shell metacharacters before
being interpolated into the tmux command. This mechanism lets operators
forward a custom log directory or any other path-shaped configuration
into tmux-managed sessions without relying on `/tmp` defaults, and is
also what end-to-end tests use to wire isolated sandboxes into per-window
binaries.

### tmux pane vs window

Default layout is **one window per worktree** (`tmux select-window` to
switch). When the operator wants to view all worktrees side-by-side, set
`tmux_pane_layout: "tiled"` to split a single window into N tiled panes.

### Skill-registry verify (overlay-load race guard, 4-stage)

After spawning each worker `claude` process, the launcher waits for the
user-level overlay (`~/.claude/`) skill catalog to register inside the new
REPL and then probes each worker before returning control to the
coordinator. This closes the **overlay-load race** (observed empirically as
4-worker simultaneous BLOCK across consecutive parallel batches in consumer
deployments) where the coordinator's `/tdd-implement` prompt arrived in the
worker REPL *before* the overlay loaded, causing the typeahead to
mis-classify the slash command as plain text and every worker to BLOCK
with `harness skill registry not loaded` 1 turn later.

| stage | name | mechanism | env override |
|---|---|---|---|
| 1 | baseline sleep | wait for overlay registration | `CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS` (default 5) |
| 2 | skill registry probe | `tmux send-keys /help` + `capture-pane` scan for 6 required skills | `CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS` (default 12, minimum 2) |
| 3 | escalate BLOCKED | inject 8-field BLOCKED final report prompt on probe failure | `CLAUDE_SKILL_VERIFY_ESCALATE` (default 1) |
| 4 | operator repush | `/parallel-worktree-v2 verify` subcommand re-runs Stages 2-3 on a live session | n/a |

Defaults:

- `CLAUDE_OVERLAY_LOAD_VERIFY=1` — set `0` to skip Stages 1-3 entirely (used
  by mock-claude e2e fixture and any non-interactive test path where the
  per-window binary cannot service `/help`).
- `CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=20` — total launch wait budget for
  Stage 1+2. If it is lower than
  `MIN_WAIT + ceil(VERIFY_TIMEOUT / 2s_poll_interval) * 2s * worker_count`,
  plus the 1s escalation delay per worker when escalation is enabled, the
  launcher raises it so every worker receives at least one registry probe
  before any MAX_WAIT skip.
- `CLAUDE_REQUIRED_SKILLS` — whitespace-separated list of skill identifiers
  the probe demands. Default is the 6 harness Phase-1-to-7 skills:
  `harness:tdd-implement harness:codex-sync harness:pseudo-coderabbit-loop`
  `harness:coderabbit-review harness:codex-team harness:session-handoff`.

The injected prompt itself is delivered as one `tmux send-keys` submission, but
it instructs the worker to return the canonical 8-field final report as
newline-separated fields (`STATUS: BLOCKED`, `CHANGED_FILES: (none)`,
`COMMIT: (none)`, ... `FORBIDDEN_ACTIONS_USED: no`). The coordinator side of
`/parallel-worktree-v2` parses the failed-slug list from launcher stderr and
routes those slugs into the **coordinator-takeover regime** by spawning a
parallel `general-purpose` Agent fan-out instead of waiting for the BLOCKED
worker final.

---

## Phase 2 — initial prompt injection per session

After all windows are ready, the coordinator sends the first prompt to
each session:

```bash
for slug in "${SLUGS[@]}"; do
  prompt="/tdd-implement ${slug_to_task_label[$slug]} --profile=${PROFILE} ${NO_COMMIT}"
  tmux send-keys -t "${TMUX_SESSION_NAME}:${slug}" "${prompt}" Enter
done
```

`/tdd-implement` v2 then runs inside each independent claude session and
drives the full quality-gate chain:

| sub-phase | what runs in the per-worktree session |
|---|---|
| Phase 1   | planning + handoff backlog / Plans.md update |
| Phase 2   | TDD red (failing test first) |
| Phase 3   | TDD green (minimum implementation) |
| Phase 4   | Codex parallel verification (each session spawns its own Codex agents) |
| Phase 5   | refactor + Codex review loop |
| Phase 5.5 | `/pseudo-coderabbit-loop --local --profile=${PROFILE}` (per worktree) |
| Phase 6   | push, then `/coderabbit-review <pr>` (Real CR Strong Clear judgement, per worktree) |
| Phase 7   | `/codex-team` adversarial second-opinion (per worktree) |

Because Phases 5.5 / 6 / 7 run **inside each worktree** instead of being
serialized in the coordinator, true parallelism is preserved through the
entire quality-gate chain.

---

## Phase 3-7 — autonomous per-worktree execution

While workers run, the coordinator does **not** hold an active reasoning
loop. It runs the progress aggregator instead:

```bash
node plugins/harness/core/src/session-manager.ts \
     --tmux-session "${TMUX_SESSION_NAME}" \
     --log-dir /tmp \
     --refresh-interval 30
```

Sample dashboard:

```text
[harness-parallel] tmux session — 4 windows, 4 sub-tasks

  | slug      | branch              | phase | last commit          | status                          |
  |-----------|---------------------|-------|----------------------|----------------------------------|
  | frontend  | feature/main-fe     | 5.5   | a1b2c3d 2 min ago    | actionable=0, Pseudo CR clean    |
  | backend   | feature/main-be     | 5     | e4f5g6h 11 min ago   | running (WARN-idle 11m)          |
  | shared    | feature/main-shared | 7     | i7j8k9l 12 min ago   | Codex Phase 7 SHIP               |
  | docs      | feature/main-docs   | 8     | m0n1o2p 18 min ago   | merged ✓                         |
```

session-manager aggregates per-worktree signal from sources available to
the dashboard path:

- **git commit log** — which slug landed which commit and when (`git log --oneline -1` in each worktree path).
- **stream-json logs** — when present at `<log_dir>/claude-log-<slug>.jsonl`, phase markers, tool calls, and completion events are parsed from the event stream.
- **idle detection** — derived first from the latest parsed stream-json event timestamp, then falls back to the latest git commit timestamp when no event stream exists; `running` / unknown-active sessions render `WARN-idle` after 10 min and `FAIL-idle` after 30 min without activity.

When a worktree explicitly opts into a headless one-shot run, it can use
the `claude-oneshot` primitive to obtain `claude -p '<prompt>' --output-format stream-json`
output and write it to `<log_dir>/claude-log-<slug>.jsonl`. session-manager
reads any such jsonl files when present, in addition to the git fallback.

---

## Phase 8 — coordinator merge train

When every worktree has reached Phase 7 (SHIP verdict), the coordinator
launches the merge train:

```text
/harness-merge-train --tmux-session=<TMUX_SESSION_NAME> --priority-mode=topological
```

The merge train:

1. confirms each PR's Real CR Strong Clear verdict (APPROVED state OR
   unresolved=0 with no rate-limited marker),
2. confirms Codex Phase 7 SHIP verdict,
3. orders squash merges by `depends_on` and `merge_priority`,
4. squash-merges PRs in sequence; the coordinator resolves rebase
   conflicts when they appear,
5. tears the tmux session down and removes worktrees once every PR has
   landed (`tmux kill-session` + `git worktree remove` + `git branch -d`).

---

## Failure recovery

| symptom | detection | action |
|---|---|---|
| 10 min without parsed stream-json events or new commits in a running window | session-manager `WARN-idle` | operator runs `/parallel-worktree-v2 attach <slug>` and inspects |
| 30 min without parsed stream-json events or new commits in a running window | session-manager `FAIL-idle` | operator kills the window (`tmux kill-window`), then resumes manually with `claude -r <session-id>` after fixing the underlying cause |
| `claude-oneshot` stream-json reports `subtype: "error_max_turns"` | jsonl parsed by session-manager | raise budget, retry; consider splitting the sub-task into smaller acceptance criteria |
| `claude-oneshot` stream-json reports `subtype: "error_during_execution"` | jsonl parsed by session-manager | inspect crash log, fix bug, retry |
| tmux session disappears (host reboot etc.) | session lookup fails | use `--rollback` to remove worktrees, or resume each branch manually |

Automatic restart is **disabled by default** — autonomous restarts of
LLM-driven tasks require explicit operator confirmation.

---

## Compatibility with the legacy `/parallel-worktree`

The legacy v1 skill remains the **default** for the foreseeable future.
v2 is **opt-in** for the workloads it is designed for (3+ parallel
long-running tasks). v1 and v2 coexist; consumer projects choose per
batch. Configuration-level forwarding (`claude_per_session_options`
present in spec.json) can route a v1 invocation to v2 transparently in
projects that adopt the v2 conventions across the board.

---

## Generality compliance

- The skill body uses **project-neutral** field names (`feature_branch`,
  `slug`, `work_item_label`).
- The placeholder paths in examples (`src/frontend/**`,
  `myproject-wt-`) are illustrative; consumer projects substitute their
  own paths.
- No internal tracker IDs, sprint identifiers, or owner-specific
  shorthand are present in this shipped spec.

---

## References

- legacy spec: `commands/parallel-worktree.md`
- companion primitives: `scripts/parallel-sessions-template.sh`,
  `core/src/session-manager.ts`, `commands/claude-oneshot.md`
- Anthropic CLI reference: <https://code.claude.com/docs/en/cli-reference>
- Anthropic skills system: <https://code.claude.com/docs/en/skills>
- Anthropic worktree issue (`.claude/` not inherited):
  <https://github.com/anthropics/claude-code/issues/28041>
- Anthropic nested-subagent OOM: <https://github.com/anthropics/claude-code/issues/19077>
- Related external work: [workmux](https://github.com/raine/workmux),
  [Codeman](https://github.com/Ark0N/Codeman)


---

## Handoff-mode Awareness Note

本 spec は legacy plans-mode (`Plans.md` 駆動) を前提とした表現で書かれている。`harness.config.json.work.taskTrackerMode = "handoff"` (template default、`harness init` で適用) project では本文中の `Plans.md` 言及を以下の `handoffPaths.<key>` 契約に従って読み替える (具体 path は consumer が `harness.config.json.work.handoffPaths` で override 可、下記は例示):

- **Active task dispatch / assignment table / progress** → `handoffPaths.backlog` + `handoffPaths.current` (例: `.docs/handoff/<project>-backlog.md` / `.docs/handoff/<project>-current.md`)
- **Completion log append** → `History.md` (legacy `Plans.md`、`harness init` で生成または migration)
- **Phase / Week / Task SSoT** → `handoffPaths.roadmap` (例: `.docs/handoff/<project>-roadmap.md`)
- **Design decisions (append-only)** → `handoffPaths.decisions` (例: `.docs/handoff/<project>-decisions.md`)

詳細は README "Plans-mode vs Handoff-mode" section + `harness.config.json` schema (HANDOFF_PATH_KEYS = `["backlog", "current", "decisions", "roadmap"]`) 参照。

(本 note は generic awareness footer、複数 commands ファイルに一括追加。各 file 本文の `Plans.md` 言及を併記 update せず、handoff-mode user は本 footer を read-and-translate する設計。)
