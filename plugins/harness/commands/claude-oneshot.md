---
name: claude-oneshot
description: "non-interactive one-shot `claude -p` wrapper that writes stream-json output to a per-slug log file for downstream monitoring. Use this primitive from a parallel orchestrator (e.g. parallel-worktree v2) when each task needs an independent top-level Claude session with its own context budget instead of the cheaper Agent-tool fan-out."
description-ja: "非対話の `claude -p` を1回実行し、スラッグ単位のログへ出力するラッパー。並列オーケストレータから複数タスクを独立 Claude セッションで実行する際に使う。"
allowed-tools: ["Bash", "Read", "Write"]
argument-hint: "[instruction|slug|cwd|output|model|permission-mode]"
---

# `/claude-oneshot` — non-interactive `claude -p` wrapper for parallel orchestration

## Purpose

Wraps a single non-interactive `claude -p <instruction>` invocation and writes its output to a per-slug log file at `/tmp/claude-log-<slug>.jsonl` (or another path resolved via the `CLAUDE_ONESHOT_LOG_DIR` env var). This skill is the **per-task primitive** used by `parallel-worktree v2` and other orchestrators that fan out N independent Claude sessions in parallel and want to monitor their progress without sharing the caller's context budget.

## When to use

- A coordinator skill needs to launch N autonomous `claude` sessions and aggregate their outputs after they finish.
- A long-running multi-phase task should run inside its own top-level `claude` process so that its 1M-context budget does not interfere with the caller's session.
- A monitor (e.g. `core/src/session-manager.ts`) is consuming `/tmp/claude-log-<slug>.jsonl` files and each launched task must write to a known path.

## When NOT to use

- The current session can simply call the `Agent` tool — `Agent` is cheaper, stays inside the caller's context, and does not require a separate process. Use `/claude-oneshot` only when isolation, tmux pane assignment, or independent context budgets are required.
- The instruction is interactive (asks the user a question mid-flight). `claude -p` is non-interactive; interactive sessions should use the regular `claude` invocation instead.

## Arguments

| flag | required | default | description |
|---|---|---|---|
| `<instruction>` | yes | — | The task prompt for the launched `claude` session |
| `--slug=<slug>` | no | `oneshot` | Slug used in the log filename `/tmp/claude-log-<slug>.jsonl` |
| `--cwd=<path>` | no | current dir | Working directory for the launched session (passed to `--add-dir`) |
| `--output=stream-json\|json\|text` | no | `stream-json` | Output format. `stream-json` is recommended for monitoring. |
| `--model=<alias>` | no | session default | Model alias (e.g. `opus`, `sonnet`) |
| `--permission-mode=<mode>` | no | `acceptEdits` | Permission mode (`acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan`) |

## Output contract

The skill writes one of two formats based on `--output`:

- `stream-json`: line-delimited JSON, one event per line, suitable for `tail -f` and the `core/src/session-manager.ts` aggregator.
- `json` or `text`: a single complete result document; use these formats only when no monitoring is needed.

The default log path is `/tmp/claude-log-<slug>.jsonl`. When the `CLAUDE_ONESHOT_LOG_DIR` env var is set, logs are written to `<CLAUDE_ONESHOT_LOG_DIR>/claude-log-<slug>.jsonl` instead. The skill returns the spawned process's PID (process id) on stdout so the caller can `wait <pid>` for completion or `kill <pid>` to terminate it.

## How to invoke

```bash
# minimum form
/claude-oneshot "Implement the auth API per acceptance criteria in spec.md"

# fully qualified form (the way parallel-worktree v2 fans out sub-tasks)
/claude-oneshot "Implement the auth API per spec.md" \
  --slug=auth-api \
  --cwd=/path/to/<your-worktree> \
  --output=stream-json \
  --model=opus \
  --permission-mode=acceptEdits
```

## Implementation outline

The skill resolves into a single `claude -p` invocation, redirected to the per-slug log file:

```bash
LOG_DIR="${CLAUDE_ONESHOT_LOG_DIR:-/tmp}"
mkdir -p "$LOG_DIR"
SAFE_SLUG="$(printf '%s' "$SLUG" | tr -cs 'A-Za-z0-9_-' '-')"
SAFE_SLUG="$(printf '%s' "$SAFE_SLUG" | sed -E 's/^[0-9-]+/slug-/')"
LOG_FILE="$LOG_DIR/claude-log-${SAFE_SLUG}.jsonl"
claude -p "<instruction>" \
  --output-format <stream-json|json|text> \
  --model <model> \
  --permission-mode <mode> \
  --add-dir "<cwd>" \
  > "$LOG_FILE" 2>&1 &
echo $!   # PID of the spawned session
```

The wrapper is intentionally thin: it does not enforce TDD, Phase 5.5/6/7 quality gates, or merge ordering. The launched session is responsible for invoking `/tdd-implement`, `/pseudo-coderabbit-loop`, `/coderabbit-review`, and `/codex-team` on its own.

## Related

- `core/src/session-manager.ts` — consumer of the per-slug log files
- `scripts/parallel-sessions-template.sh` — alternative tmux-based launcher
- `commands/parallel-worktree-v2.md` — *planned* coordinator that fans out N `/claude-oneshot` invocations. Until that coordinator lands, this skill is callable directly by any orchestrator that wants the per-slug log path contract.

## Notes

- Compatible with Claude Code 2.1.49+ (`claude -p`, `--output-format stream-json`, `--permission-mode`).
- For non-trivial work, the launched session itself should call `/tdd-implement`, `/pseudo-coderabbit-loop`, `/coderabbit-review`, and `/codex-team` to satisfy the harness AND-judgment quality gate. The wrapper does not know which of those are required.
- The log file is overwrite-mode: re-running with the same `--slug` replaces the previous log unless `CLAUDE_ONESHOT_LOG_DIR` is paired with external rotation (logrotate / per-run timestamped sub-dirs).
- **Slug must be a filesystem- and tmux-target-safe identifier**. The wrapper concatenates `<slug>` directly into the log file path (`<LOG_DIR>/claude-log-<slug>.jsonl`), and the tmux launcher targets windows as `<session>:<slug>`. The launched skill MUST validate `<slug>` to match the pattern `^[a-zA-Z_][a-zA-Z0-9_-]*$` *before* invoking this wrapper — otherwise a malicious or malformed slug containing `.`, `..`, `/`, a leading digit, or shell metacharacters can redirect log writes, break tmux target parsing, or break out of the surrounding shell context. Reference: the equivalent `validate_slug` regex in `scripts/parallel-sessions-template.sh`; callers SHOULD reuse that contract.
