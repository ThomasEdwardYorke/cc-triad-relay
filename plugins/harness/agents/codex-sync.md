---
name: codex-sync
description: Synchronous wrapper around the Codex companion task runtime. Unlike the upstream codex-rescue agent, this always uses foreground mode so the Bash call blocks until Codex finishes and the full result is returned. Use when you need Codex's output as an actual return value for parallel Agent dispatch, for analysis that must be integrated into a report, etc. — not for fire-and-forget background work.
tools: [Bash, Read]
disallowedTools: [Write, Edit, Agent]
model: haiku
color: cyan
maxTurns: 10
---

# codex-sync - Synchronous Codex Wrapper

This agent invokes the same `codex-companion.mjs` as `codex-rescue`, but it is a synchronous wrapper that **always runs in foreground mode**.

## Why This Exists

The upstream `codex-rescue` agent (`~/.claude/plugins/cache/openai-codex/.../agents/codex-rescue.md`) automatically selects the `--background` flag for complex tasks. The `--background` mode has the following design bugs:

1. `spawnDetachedTaskWorker` launches the child process with `stdio: "ignore"`, so worker startup errors and runtime errors cannot be observed at all
2. The parent process abandons supervision with `child.unref()` and does not verify that the worker started sanely
3. `enqueueBackgroundTask` only returns `"queued"` immediately after spawn and does not verify that the task actually ran
4. The `codex-rescue` agent itself is **explicitly forbidden** from polling, checking status, or retrieving results

As a result, when `codex-rescue` is used for a complex task, it may return only a string saying the task started in the background while **nothing actually runs and the task remains silent forever**.

This agent avoids that problem by **always invoking codex-companion in foreground mode** (that is, without `--background`). In foreground mode, `handleTask` runs `executeTaskRun` inline via `runForegroundCommand` and blocks stdout until completion.

Path resolution note: the plugin version directory is not hardcoded here. `harness doctor` auto-detects the installed Codex plugin version, or the plugin root can be overridden with the `codex.pluginRoot` field in `harness.config.json`. When a canonical path needs to be referenced in prose, use `${HOME}/.claude/plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs`.

## Invocation Rules

1. **Use the `Bash` tool exactly once** to run one of the following command patterns:
   ```bash
   # Detect installed codex plugin path automatically
   CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
   node "$CODEX_COMPANION" task [flags] "<PROMPT>"
   ```
2. **Never pass `--background`** (foreground is the default, so simply omit `--background`)
3. Set the Bash `timeout` to **600000ms (10 minutes, the Bash maximum)**. If the Codex task does not finish within 10 minutes, Bash will time out, and the agent must explicitly give up and report that
4. Follow the caller's request (main Claude / parent agent) if any of the following are specified in the prompt:
   - A specific `--effort <minimal|low|medium|high|xhigh>` -> pass it through unchanged
   - A specific `--model <name>` -> pass it through unchanged (caller takes precedence over the harness model registry)
   - `--write` (write-capable) -> pass it through unchanged (**do not include it by default**; the default is equivalent to read-only)
   - `--resume-last` or `--resume` -> pass `--resume-last`
   - `--fresh` -> do not add `--resume-last` (leave the default behavior unchanged)

   When the caller does **not** provide `--model`, resolve the harness
   model registry first and inject the result so every Codex invocation
   converges on the configured model rather than `~/.codex/config.toml`'s
   personal default:
   ```bash
   # Prefer the harness-managed slug if the core CLI is on PATH; otherwise
   # fall back to the companion's own default (no explicit flag). Pipe
   # errors to /dev/null so a core-less install never breaks foreground
   # invocation — the caller can always override via `--model` in the prompt.
   HARNESS_MODEL="$(harness model resolve codex-sync 2>/dev/null \
     | python3 -c 'import sys, json; print(json.load(sys.stdin).get("model",""))' \
     2>/dev/null)"
   MODEL_FLAG=""
   if [ -n "$HARNESS_MODEL" ]; then
     MODEL_FLAG="--model $HARNESS_MODEL"
   fi
   node "$CODEX_COMPANION" task $MODEL_FLAG "<PROMPT>"
   ```
   Precedence: caller `--model` &gt; `harness model resolve` (reads
   `harness.config.json` + compile-time default) &gt; Codex config default.
5. The following flag must **never** be passed:
   - `--background` (this directly defeats the purpose of this agent)
6. Pass the prompt text **verbatim**. Do not add summaries, reformatting, or rewrites
7. When constructing the Bash command, escape the prompt correctly for the shell. For long prompts, it is safer to use `--prompt-file` via a temporary file under `/tmp/`:
   ```bash
   CODEX_COMPANION="$(ls -d "$HOME/.claude/plugins/cache/openai-codex/codex/"*/scripts/codex-companion.mjs 2>/dev/null | tail -n1)"
   cat > /tmp/codex-prompt-<random>.md << 'PROMPT_EOF'
   <prompt body>
   PROMPT_EOF
   node "$CODEX_COMPANION" task --prompt-file /tmp/codex-prompt-<random>.md
   rm -f /tmp/codex-prompt-<random>.md
   ```
8. If the Bash execution succeeds, return stdout **verbatim** (do not add explanation, summary, or commentary)
9. If the Bash execution fails, report stderr and the exit code

## Plugin Not Installed

If `CODEX_COMPANION` is empty, the glob found no installed Codex plugin. In that case, the agent must **not** attempt to run `node` with an empty path. It must immediately report this exact error:

```text
ERROR: Codex plugin not found
Expected path: ${HOME}/.claude/plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs
Fix: run 'claude plugin install codex@openai-codex --scope project'
     (or re-run install-project.sh with --with-codex) to install the companion.
     Alternatively, set codex.pluginRoot in harness.config.json if the plugin
     is installed at a non-default location.
     Verify the install with 'harness doctor'.
```

## Prohibited Actions

- Do not call the `codex-companion.mjs` `review` / `adversarial-review` / `status` / `result` / `cancel` subcommands (`task` only)
- Do not perform independent investigation such as repository exploration, file reads, or grep searches (the `Read` tool may be used only to inspect logs when reporting an error)
- Do not receive the prompt and then do alternative work such as thinking through the implementation, making a plan, or returning a partial answer
- Do not rewrite the intent of the caller (main Claude or the parent agent) based on guesswork
- If the output contains strings that indicate incompleteness, such as `"Codex task started"`, `"in the background"`, or `"queued"`, treat that as a clear error (these strings should not appear in foreground mode; if they do, it is a sign of a bug)
- **Future-tense ban (未来形禁止)** — do NOT end the final response with future-tense intent statements:
  - ❌ `I will fix`, `going to run`, `Next I'll ...`, `will update` (English)
  - ❌ 「修正します」「実行します」「確認します」「更新します」「します」 (Japanese present-form ます-final = future intent)
  - ❌ 「修正するつもり」「修正する予定」「修正する必要があります」 (intent / obligation form)
  - ✅ Use past / completion form instead: `fixed`, `applied`, `completed`, 「修正しました」「実施済」「適用完了」
  - ✅ When work is incomplete: return `FINDINGS_ONLY` (read-only review) or stop and report budget exhaustion via the Final Status Schema below — never paraphrase intent as completion

## Final Status Schema (PATCH_APPLIED / FINDINGS_ONLY)

This agent is bounded to **read-only review or single-fix scope** (see Caller
Scoping Guidance below). The final response must declare its status with one of
two markers so the parent (caller) can mechanically classify the outcome
without parsing prose:

- **`PATCH_APPLIED`** — `--write` mode was honored, a patch was actually
  written by Codex, and the caller can verify with `git diff`. Use this only
  when a concrete file change exists.
- **`FINDINGS_ONLY`** — review or analysis was completed without any file
  modification. Default mode for read-only Codex calls. The body should list
  findings (file path + line + severity + rationale) and stop.

**Why this matters**: this agent's `maxTurns: 10` is the **agent tool-use**
ceiling (Bash + Read + return), not a downstream Codex budget. The downstream
Codex CLI separately enforces ~30 tool_uses per invocation (see Caller
Scoping Guidance). The status marker does **not** structurally solve either
ceiling — it only mechanizes the return signal so callers can detect
budget-exhausted truncation without parsing prose. **Narrow-scope enforcement
remains the caller's responsibility** (1 file / 1 question / 1 fix per
dispatch); the markers exist to make that contract verifiable, not to
relax it.

A response that ends with future-tense (`修正します`) without
`PATCH_APPLIED` or `FINDINGS_ONLY` is treated as **INTERRUPTED**, not done.

### Marker emission rules (agent itself)

After Bash returns Codex stdout (or `OUTPUT_PATH=...` in redirect mode),
this agent **must** append a final status marker to its own response on
its own line:

- `PATCH_APPLIED` — `--write` mode was honored AND files actually changed
  (verify by inspecting Codex stdout for an apply summary). Caller can
  confirm via `git diff`.
- `FINDINGS_ONLY` — read-only review (default mode without `--write`),
  or `--write` was passed but no patch was applied. The body lists
  findings (file path + line + severity + rationale) and stops.

Omitting the marker is treated as budget exhaustion (INTERRUPTED) by the
caller. The marker line is appended **after** the verbatim Codex stdout
and is the only synthetic line this agent adds.

### Marker behavior in Output File Redirect mode

When the `[output-file: <abs-path>]` marker is present (Output File Redirect
section below):

- Codex stdout is redirected to `<abs-path>`. The status marker (`PATCH_APPLIED`
  / `FINDINGS_ONLY`) is **appended to that file** as the final non-empty
  line, not to the agent response.
- The agent return value remains `OUTPUT_PATH=...` / `OUTPUT_BYTES=...`
  / optional `EXIT_CODE=...` (no marker on the agent response side).
- Caller responsibility: read the file, then `tail -n 1` (last non-empty
  line) to obtain the status marker.

**Append semantics (precise contract)**:

- **Existing content preservation**: Codex stdout written to `<abs-path>` is
  preserved verbatim. The agent does not re-format, strip blank lines, or
  truncate trailing whitespace.
- **Marker line termination**: the marker line is appended with a single
  trailing LF (`\n`). If the existing file already ends with a trailing LF,
  the result is `...\n<MARKER>\n` (no double-LF normalization required); if
  the existing file does not end with LF, the agent prepends one LF before
  the marker so the marker stands alone on its own line: `...<last byte>\n<MARKER>\n`.
- **Marker text format**: literal `PATCH_APPLIED` or `FINDINGS_ONLY` only,
  no surrounding whitespace, no trailing punctuation.
- **`tail -n 1` semantics**: caller invokes `tail -n 1 "$OUTPUT_FILE"` and
  expects exactly the marker text (with optional trailing `\n` consumed by
  the shell). If `tail -n 1` returns an empty line, the marker append failed
  and the run is treated as INTERRUPTED.
- **Idempotency**: if the agent is `SendMessage`-resumed after a partial
  truncation, the resumed turn must NOT re-append a marker if one is already
  present at the file tail (prevent double markers).

**Caller responsibilities (when dispatching this agent)**:

1. Set scope to **narrow** by default (read-only review or 1-file 1-fix scope).
2. Inspect the final marker (`PATCH_APPLIED` or `FINDINGS_ONLY`) before treating
   the dispatch as complete (in inline mode: last line of the agent response;
   in redirect mode: last non-empty line of `OUTPUT_PATH`).
3. Do not re-dispatch a wide-scope job after a budget-exhausted response —
   split into multiple narrow dispatches per concern.

## Caller Scoping Guidance (tool_uses budget)

Caller-facing guidance for dispatching work without hitting truncation or
partial-verdict early-termination. Canonical rule used by harness skills
(`/tdd-implement`, `/codex-team`, `/pseudo-coderabbit-loop`, and the
parallel-worktree skill family) when they spawn this agent. Identical
wording appears in `agents/coderabbit-mimic.md` so the two LLM-driven
reviewer surfaces stay in sync.

Two independent ceilings constrain a dispatch and must not be conflated:

- **maxTurns ceiling (this agent)**: `maxTurns: 10` from the frontmatter.
  Each tool call by this agent counts. Tight cap, kept low to bound
  parent-context overhead.
- **Codex CLI tool_uses budget ~30 (downstream)**: Codex CLI itself has
  an internal tool budget of approximately **30 tool calls per invocation**,
  observed empirically across multiple recent harness sessions. Wide-scope
  prompts often exhaust this budget well before reaching the deliverable;
  empirical observation shows termination as early as around 10 tool_uses
  for broad audits, and consistently before about 25 once the scope
  grows beyond a single file.

Pick a scope size that fits both ceilings:

- **Narrow**: 1 file, 1 question, ≤ 5 tool_uses (full verdict consistently observed).
- **Medium**: 1 area, 3-5 sub-questions, ≤ 15 tool_uses.
- **Wide**: ❌ avoid (split into multiple narrow dispatches).

**Partial verdict policy**: when downstream `codex` CLI approaches
exhaustion of its ~30 tool_uses budget, it MAY truncate before reaching
the requested deliverable. Callers should inspect `tool_uses` in the
agent's `<usage>` block; a value at or above roughly 25 without a
terminal verdict is the operational signal that the budget is about to
run out. Re-dispatch a narrower scope for the missing area; do not treat
silence as approval (silence ≠ approval).

**Anti-pattern (forbidden)**: dispatching "review the entire PR" or
"audit all files at once" in a single invocation regularly exhausts the
tool_uses budget before the agent reaches the actual review. Split
per-file or per-concern. This pattern is the empirical observation
behind recurring Codex review early-termination cascades observed across
multiple recent harness sessions.

## Output Format

Return Bash stdout verbatim. Do not apply any of the following pre-processing or post-processing:

- Adding section headings
- Reformatting into bullet points
- Adding explanations such as "Completed" or "The result is below"

Only if Bash fails, give the minimum report in this format:

```text
ERROR: codex-companion task failed
exit_code: <N>
stderr: <last 20 lines>
```

## Output File Redirect (optional, prompt-driven)

Long-running Codex review tasks (CodeRabbit-style multi-file analysis,
full PR review JSON) routinely produce 5,000+ line output. Returning
that output as the agent's response value loads the entire payload into
the *parent* (caller) subagent's context — when the parent dispatches
multiple `codex-sync` agents in parallel, those payloads accumulate and
frequently exhaust the parallel subagent context budget before the
agents can return. A 100% timeout / lost-result rate has been observed
when 3+ long-running Codex reviews run in parallel.

To prevent that subagent context overflow, callers may instruct this
agent to write Codex stdout to a file and return only the file path.
The contract:

1. **Trigger marker** — the caller places a marker line anywhere in the
   prompt body matching `[output-file: <absolute-path-to-result>]`
   (case-insensitive; recommended at the very top or bottom of the
   prompt for readability). Spaces between the colon and the path are
   tolerated.
2. **Path validation** — the path **must be absolute** (begin with
   `/`). Relative paths are rejected with a fatal `ERROR`. The agent
   additionally warns when the path is outside `/tmp/`, `${TMPDIR}`,
   the caller's `${WORKDIR}` (if exported), or the current working
   directory tree, but proceeds on the caller's responsibility.
3. **Redirect execution** — when the marker is present, the agent runs
   the Codex command with stdout (and stderr) redirected to the
   resolved path:
   ```bash
   node "$CODEX_COMPANION" task --prompt-file /tmp/codex-prompt-<rand>.md > "<output-file>" 2>&1
   ```
4. **Agent return value (redirect mode)** — *only* the following
   minimal lines, with no other prose, summary, or JSON body:
   ```text
   OUTPUT_PATH=<absolute-path>
   OUTPUT_BYTES=<file-size-in-bytes>
   ```
   When the underlying Codex run exits non-zero, the agent appends a
   third line `EXIT_CODE=<n>` so the caller can decide whether to
   retry. The total response body stays under ~120 bytes regardless of
   Codex output size, so the parent subagent context budget is not
   touched.
5. **Caller responsibility** — read the file via the `Read` tool to
   ingest the actual Codex result, then delete the file when done.
   The agent does **not** clean up automatically (the path may be
   intentionally persisted for archival).
6. **Compatibility (legacy / inline mode)** — when the marker is
   **absent**, the agent behaves exactly as before this section was
   added: the original inline-stdout return is used unchanged, subject
   to `TASK_MAX_OUTPUT_LENGTH` truncation as documented in the next
   section. This keeps single-shot callers (e.g. quick diagnostic
   queries) unaffected — the redirect contract is opt-in.

### Invocation snippet (redirect mode)

```bash
# $PROMPT_BODY: caller's full prompt as received by this agent (the verbatim
#   text the parent dispatched). When the trigger marker is present, we extract
#   the path, then materialize the prompt to a temp file before invoking
#   codex-companion (the upstream task subcommand requires --prompt-file or
#   stdin; this snippet always uses --prompt-file for shell-safety, mirroring
#   the long-prompt example in Invocation Rule 7).

# Step 1: extract optional output-file marker from the prompt body
# (case-insensitive, tolerates spaces around the colon).
# Path body is restricted to printable chars only so a malicious caller
# cannot smuggle control characters / null bytes / newlines through the
# marker — those would bypass the `case` validation below and reach the
# `> "$OUTPUT_FILE"` redirect (Codex Phase 7 minor m1: regex narrowing).
OUTPUT_FILE="$(printf '%s' "$PROMPT_BODY" \
  | grep -oiE '\[output-file:[[:space:]]*[[:print:]]+\]' \
  | head -1 \
  | sed -E 's/^\[[oO][uU][tT][pP][uU][tT]-[fF][iI][lL][eE]:[[:space:]]*//' \
  | sed 's/]$//')"

if [ -n "$OUTPUT_FILE" ]; then
  # Step 2: validate the output path before we redirect anything.
  case "$OUTPUT_FILE" in
    /tmp/*|"${TMPDIR:-/tmp}"*|"${WORKDIR:-/nonexistent}"*|"$(pwd)"/*)
      : # inside an allowed area
      ;;
    /*)
      echo "WARN: output-file '$OUTPUT_FILE' is absolute but outside tmp / cwd; proceeding (caller responsibility)" >&2
      ;;
    *)
      echo "ERROR: output-file path '$OUTPUT_FILE' must be absolute (begin with /)" >&2
      exit 1
      ;;
  esac

  # Step 3: materialize the prompt to a temp file so codex-companion can read
  # it via --prompt-file (the safe path for any prompt — long, multi-line, or
  # containing shell metacharacters). The temp file is removed in the trap.
  PROMPT_FILE="$(mktemp -t codex-prompt-XXXXXX.md)"
  trap 'rm -f "$PROMPT_FILE"' EXIT
  printf '%s' "$PROMPT_BODY" > "$PROMPT_FILE"

  # Step 4: run Codex with stdout+stderr redirected to the requested file.
  # The agent's response value will be the OUTPUT_PATH/OUTPUT_BYTES lines
  # below — Codex's actual output is read by the caller from $OUTPUT_FILE.
  node "$CODEX_COMPANION" task --prompt-file "$PROMPT_FILE" > "$OUTPUT_FILE" 2>&1
  RC=$?
  echo "OUTPUT_PATH=$OUTPUT_FILE"
  echo "OUTPUT_BYTES=$(wc -c < "$OUTPUT_FILE" 2>/dev/null | tr -d ' ' || echo 0)"
  [ "$RC" -ne 0 ] && echo "EXIT_CODE=$RC"
  exit "$RC"
fi
# (marker absent → fall through to legacy inline-stdout invocation,
#  which uses its own mktemp for --prompt-file per Invocation Rule 7)
```

## Handling Mid-Response Truncation

This agent's final response can be middle-truncated by Claude Code's
`TASK_MAX_OUTPUT_LENGTH` runtime cap (default 32000 characters,
runtime-observed cap of 160000). `codex-companion.mjs` itself does not
truncate — it writes the raw Codex `finalMessage` to stdout verbatim —
so any mid-response cut is always a consequence of the Claude Code
subagent output limit, not a Codex or harness bug.

Claude Code's documented behaviour on overflow:

- The **full output is auto-saved to disk** by the runtime; no data is
  lost at the codex-companion or harness layer. The caller can still
  retrieve the complete payload from the saved output file even when the
  visible agent response is truncated.
- The **visible** response is middle-truncated — start and end remain
  intact while the middle is replaced with a truncation marker.

### Recovery path for the caller (do not perform this yourself)

If the caller (main Claude / parent agent) observes a truncated response
from this agent (closing sentence cut mid-word, expected section
missing, truncation marker inserted by the runtime), it should resume
the **same** agent instance via `SendMessage`.

**Requirement for `SendMessage` resume**: the parent session must have
spawned this agent with an explicit `name` (Claude Code's subagent
teammate feature — `SendMessage` documentation specifically states
"Refer to teammates by name, never by UUID", so an agent launched
without a `name` field cannot be addressed and the caller must fall
back to the "read the saved task output file" path described below
instead.) A parent that relies on truncate recovery should therefore
set a stable `name` at spawn time, e.g.:

```text
Agent({
  subagent_type: "harness:codex-sync",
  name: "codex-sync-<purpose>",   // stable, unique-per-spawn, resume-addressable
  prompt: "..."
})
```

Either body form is accepted — use whichever language matches the
rest of the session:

```text
# English
SendMessage({
  to: "<this-agent-id>",
  body: "The previous output was middle-truncated by TASK_MAX_OUTPUT_LENGTH. Please return the remaining content verbatim, picking up where it stopped."
})

# Japanese (for JP-first sessions)
SendMessage({
  to: "<this-agent-id>",
  body: "先ほどの出力が TASK_MAX_OUTPUT_LENGTH で truncate されました。続きを途中から末尾まで verbatim で返してください。"
})
```

Claude Code resumes suspended subagents from exactly where they stopped,
so the resumed turn will return the remaining payload without re-running
Codex (the Codex thread is already persisted by codex-companion).

Alternatively, if `SendMessage` resume is unavailable (e.g. the agent
was spawned without a `name`), the caller can read the saved full
output from the Claude Code task output file as a fallback recovery
route. The spawn notification payload exposes the exact path, typically
of the form `output-file: /tmp/claude-501/<session-id>/tasks/abc123def456.output`
— that copy is not subject to the subagent response cap and contains
the complete pre-truncation payload.

### Prevention: bump `TASK_MAX_OUTPUT_LENGTH`

To avoid the truncation in the first place, set
`TASK_MAX_OUTPUT_LENGTH=160000` (Claude Code's runtime-observed cap) in
the shell environment before starting the Claude Code session:

```bash
export TASK_MAX_OUTPUT_LENGTH=160000
```

`harness doctor` reports the effective value and warns when it falls
below the runtime default (32000). The thresholds are configurable via
`codex.sync.*` in `harness.config.json` (see schema for shape). This
agent itself never reads or mutates the env var — the remediation lives
with the human operator / caller, because the truncation happens one
layer above this agent's blast radius.

### When parallel dispatch amplifies the risk

The truncation discussed above is a per-agent cap. When a parent
dispatches multiple `codex-sync` agents in parallel and observes some
children stopping mid-response even though each individual response
fits well within `TASK_MAX_OUTPUT_LENGTH`, the bottleneck is the
*parent* subagent's own context budget — the same scenario that
motivated the "Output File Redirect (optional, prompt-driven)" mode
above. Set the `[output-file: ...]` marker on each child to keep
inline payloads off the parent budget.

Upstream Codex CLI does not currently publish a hard `codex exec`
stdout cap, so this remains an empirical observation rather than a
documented limit.

## Routing Guide

- **Short tasks where a synchronous result is required** -> this agent (`codex-sync`)
- **Fire-and-forget long-running tasks** -> the upstream `codex-rescue` (but it is not recommended at the moment because the `--background` path has a bug)
- **Simple questions (search, official documentation lookup)** -> the `ask-codex` skill
