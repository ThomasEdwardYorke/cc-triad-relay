#!/usr/bin/env bash
#
# tests/e2e/fixtures/mock-claude.sh
#
# Mock `claude` CLI binary for the parallel-worktree-v2 end-to-end smoke
# test. Reads `-n <slug>` from argv (matching the real Claude CLI invocation
# emitted by parallel-sessions-template.sh `cmd_start`), writes 9 stream-json
# events (8 assistant + 1 result) to
# `${CLAUDE_ONESHOT_LOG_DIR:-/tmp}/claude-log-<slug>.jsonl`, and exits 0.
#
# This binary is invoked as:
#   <this-script> -n <slug> [--model <alias>] --permission-mode <mode>
#
# CLAUDE_ONESHOT_LOG_DIR must be inherited from the parent shell into the tmux
# session — the launcher pipes it through `tmux new-session -e KEY=VAL` for
# this purpose.
#
# Generic placeholders: <slug> / <feature_branch> / <your-project>.

set -euo pipefail

# Cleanup on any signal so the tmux pane terminates predictably.
# Currently intentionally a no-op: the only side effect this script has is
# the per-slug log file under CLAUDE_ONESHOT_LOG_DIR, and the smoke test
# runner removes the entire sandbox (including that directory) on
# success/failure/SIGINT/SIGTERM. Removing the log here would race the
# session-manager polling loop and silently steal data the test is
# asserting on. If a future revision adds persistent state (e.g. a tmp
# tempo for multi-step orchestration), implement teardown here.
on_exit() {
  :
}
trap on_exit EXIT INT TERM

SLUG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)
      if [[ $# -lt 2 ]]; then
        echo "mock-claude: -n requires a value" >&2
        exit 2
      fi
      SLUG="$2"
      shift 2
      ;;
    --model|--permission-mode)
      # Accept and ignore (real claude CLI consumes; mock does not need them).
      # A previous `shift 2 || true` pattern swallowed the failure when the
      # option was supplied without a value, leaving the outer
      # `while [[ $# -gt 0 ]]` loop spinning on the same `$1` forever. Check
      # `$#` explicitly (mirroring the `-n` branch) so a missing value exits
      # with a clear error instead of silently hanging the e2e smoke under
      # the smoke-test polling deadline.
      if [[ $# -lt 2 ]]; then
        echo "mock-claude: $1 requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    -*)
      # Unknown option (anything starting with `-` that did not match
      # the explicit cases above). Real claude CLI rejects unknown
      # options; mirror that here so a CLI contract change in the
      # launcher (e.g. a new `--print` flag) shows up as a clear smoke
      # failure instead of being silently swallowed.
      echo "mock-claude: unknown option: $1" >&2
      exit 2
      ;;
    *)
      # Plain positional argument (no leading `-`). Drop and continue;
      # the real CLI ignores extra positionals when -n is supplied.
      shift
      ;;
  esac
done

if [[ -z "$SLUG" ]]; then
  echo "mock-claude: missing required -n <slug>" >&2
  exit 2
fi

# SLUG flows directly into LOG_FILE (${LOG_DIR}/claude-log-${SLUG}.jsonl) so
# any value that contains a path separator or `..` could escape LOG_DIR and
# overwrite arbitrary files. Mirror parallel-sessions-template.sh
# `validate_identifier` (which accepts dots so callers can use slugs like
# `api.v2`) but additionally reject `..` (parent-directory escape) and a
# leading `.` (hidden-file alias) — the launcher tolerates those patterns
# in its own validator but they would still escape the LOG_DIR boundary if
# interpolated into LOG_FILE.
if [[ ! "$SLUG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "mock-claude: invalid -n <slug>='$SLUG' (must match [A-Za-z0-9._-]+)" >&2
  exit 2
fi
if [[ "$SLUG" == *..* ]]; then
  echo "mock-claude: invalid -n <slug>='$SLUG' (must not contain '..')" >&2
  exit 2
fi
if [[ "$SLUG" == .* ]]; then
  echo "mock-claude: invalid -n <slug>='$SLUG' (must not start with '.')" >&2
  exit 2
fi

LOG_DIR="${CLAUDE_ONESHOT_LOG_DIR:-/tmp}"
if [[ ! -d "$LOG_DIR" ]]; then
  mkdir -p "$LOG_DIR"
fi
LOG_FILE="${LOG_DIR}/claude-log-${SLUG}.jsonl"

iso_ts() {
  # GNU date and BSD date both accept this format. UTC + ms-precision is the
  # shape the real Claude Code stream-json emits; the suffix is a
  # constant `Z` rather than `+00:00` to match observed wire format.
  date -u +"%Y-%m-%dT%H:%M:%S.000Z"
}

emit() {
  printf '%s\n' "$1" >> "$LOG_FILE"
}

# Truncate any prior log so a re-run is deterministic. The smoke test sets
# CLAUDE_ONESHOT_LOG_DIR to a fresh per-run sandbox, but the safety net costs
# nothing.
: > "$LOG_FILE"

# ─── 9-event sequence: 8 assistant + 1 result (mirrors a TDD round) ─────────
#
# session-manager.ts (parseAssistant + detectPhaseMarker) early-returns on
# the first matching block per assistant message, so each assistant event
# must contain exactly one phase-bearing block. The trailing `result` event
# is what the real Claude CLI emits at session end and is parsed as a
# `completion` SessionEvent.

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskUpdate","input":{"task_id":"1","status":"in_progress"}}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Phase 2 RED - failing test in place"}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"src/foo.ts"}}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Phase 3 GREEN - implementation passes"}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git add -A && git commit -m wip"}}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Phase 5.5 actionable=0 (Pseudo CR clean)"}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Phase 6 Real CR APPROVED"}]},"timestamp":"%s"}' "$(iso_ts)")"
sleep 0.1

emit "$(printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Phase 7 SHIP"}]},"timestamp":"%s"}' "$(iso_ts)")"

# Final result event is what real claude emits at session end; session-manager
# treats type=result as a `completion` SessionEvent, but is not required for
# the smoke (Phase 7 SHIP marker already pushes status to "ship").
emit "$(printf '{"type":"result","subtype":"success","is_error":false,"timestamp":"%s"}' "$(iso_ts)")"

exit 0
