#!/usr/bin/env bash
#
# parallel-sessions-template.sh
#
# Tmux-based parallel-session launcher for Model B parallel-worktree
# orchestration. Each slug gets its own git worktree, its own tmux window,
# and its own independent top-level `claude` process. Designed to be copied
# into a project's scripts/ directory and customised via env vars.
#
# Generic — uses <slug> / <feature_branch> / <your-project> placeholders.
# See `commands/parallel-worktree.md` (Model A v1) and the upcoming
# `parallel-worktree-v2.md` (Model B) for the orchestrator skill that calls
# into this template.

set -euo pipefail

DRY_RUN=0

# --- Input validation (injection prevention) -------------------------------
# Per-input charset enforcement for values that flow into `bash -c "$*"` (via
# emit) or into tmux / git command strings. The validators are defence-in-
# depth, not a guarantee that every operator-set env var is safe — values
# such as `CLAUDE_BIN` or `TMUX_SESSION_NAME` are operator-trust-boundary
# inputs, and the harness assumes the caller does not set them to a hostile
# command. The validators rule out the common-mistake case (paths with `;`,
# slugs with `'`, branch names with `..`) so a typo or an unsafe upstream
# config value cannot escape into shell context. They are NOT a sandbox.

validate_identifier() {
  # alphanumeric + underscore + hyphen + dot only.
  # Used for: slug, CLAUDE_MODEL alias.
  local name="$1"
  local val="$2"
  if [[ ! "$val" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Error: $name '$val' contains invalid characters (allowed: a-z A-Z 0-9 . _ -)" >&2
    exit 2
  fi
}

validate_branch_name() {
  # git ref-name subset: alphanumeric + . _ - / only, no `..`, no leading -.
  local val="$1"
  if [[ ! "$val" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
    echo "Error: feature branch '$val' contains invalid characters (allowed: a-z A-Z 0-9 . _ - /)" >&2
    exit 2
  fi
  if [[ "$val" == *..* ]]; then
    echo "Error: feature branch '$val' contains '..' (invalid in git ref)" >&2
    exit 2
  fi
  if [[ "$val" == -* ]]; then
    echo "Error: feature branch '$val' must not start with '-'" >&2
    exit 2
  fi
}

validate_permission_mode() {
  case "$1" in
    acceptEdits|auto|bypassPermissions|default|dontAsk|plan) ;;
    *)
      echo "Error: invalid CLAUDE_PERMISSION_MODE '$1' (expected: acceptEdits / auto / bypassPermissions / default / dontAsk / plan)" >&2
      exit 2
      ;;
  esac
}

validate_env_value() {
  # Path-safe charset for env values that flow into `tmux new-session -e KEY=VAL`
  # via `bash -c`. Rejects shell metacharacters, quotes, and whitespace that
  # would break out of the surrounding single-quoted wrapper. The allowed
  # superset (`[a-zA-Z0-9._/=:@,+-]+`) covers absolute paths, comma lists,
  # `KEY=val` chains and email-like values without compromising injection
  # safety. Values with spaces, Unicode (non-ASCII), or angle brackets are
  # intentionally rejected — callers must pass-through such cases via a
  # validated mount path or a config file, not via env.
  local key="$1" val="$2"
  if [[ ! "$val" =~ ^[a-zA-Z0-9._/=:@,+-]+$ ]]; then
    echo "Error: env var '$key' value contains characters outside [a-zA-Z0-9._/=:@,+-]" >&2
    exit 2
  fi
}

validate_env_var_name() {
  # POSIX-compliant shell parameter name: leading [A-Za-z_] then [A-Za-z0-9_]*.
  # Used for keys that flow through `${!key:-}` indirect expansion. Hyphen
  # and dot are rejected because Bash 5 raises `bad substitution` on
  # `${!BAD-KEY:-}` / `${!BAD.KEY:-}`, which would crash the launcher
  # mid-loop and leak partial worktree state.
  local val="$1"
  if [[ ! "$val" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Error: env var name '$val' must match POSIX [A-Za-z_][A-Za-z0-9_]* (no hyphen, dot, leading digit)" >&2
    exit 2
  fi
}

usage() {
  cat <<'USAGE'
parallel-sessions-template.sh — tmux-based parallel-session launcher

Usage:
  parallel-sessions-template.sh [--dry-run] start <feature_branch> <slug1> [slug2 ...]
  parallel-sessions-template.sh [--dry-run] stop  [<session_name>]
  parallel-sessions-template.sh [--dry-run] status [<session_name>]
  parallel-sessions-template.sh [--dry-run] attach <slug> [<session_name>]
  parallel-sessions-template.sh --help

Subcommands:
  start    Create N git worktrees + N tmux windows + N independent claude sessions.
  stop     Kill the tmux session (no worktree cleanup).
  status   Print tmux windows + per-worktree git log -1.
  attach   Attach to the tmux session and select a slug's window.

Flags:
  --dry-run  Print the planned commands without executing tmux / git / claude.
  --help     Show this help.

Env vars:
  TMUX_SESSION_NAME       (default: harness-parallel)
  WORKTREE_PARENT_DIR     (default: parent of cwd, i.e. ..)
  WORKTREE_PREFIX         (default: <project>-wt-, derived from cwd basename)
  CLAUDE_BIN              (default: claude)
  CLAUDE_MODEL            (optional, passed as claude --model <alias>)
  CLAUDE_PERMISSION_MODE  (default: acceptEdits)
  CLAUDE_ONESHOT_LOG_DIR  (optional, forwarded to tmux session via `-e`)
  TMUX_PASS_ENV           (optional, whitespace-separated extra env var
                           names to forward via `-e`)

Examples:
  # forward CLAUDE_ONESHOT_LOG_DIR + a custom MY_TOKEN to each tmux window
  CLAUDE_ONESHOT_LOG_DIR=/tmp/run42 \
  TMUX_PASS_ENV="MY_TOKEN MY_REGION" \
  MY_TOKEN=abc MY_REGION=jp \
    parallel-sessions-template.sh start main frontend backend

Each slug becomes:
  - branch:   feature/<feature_branch>-<slug>
  - worktree: $WORKTREE_PARENT_DIR/$WORKTREE_PREFIX<slug>
  - tmux:     window <slug> inside session $TMUX_SESSION_NAME
  - claude:   independent top-level process running inside that tmux window
USAGE
}

emit() {
  # Print + execute (or print only when --dry-run).
  # Args are joined with single spaces; embedded quoting is the caller's
  # responsibility. We use `bash -c` so quoted sub-strings such as
  # `tmux new-window ... "cd '$wt' && claude -n ..."` survive intact.
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    bash -c "$*"
  fi
}

resolve_session_name() {
  printf '%s' "${TMUX_SESSION_NAME:-harness-parallel}"
}

resolve_worktree_parent_dir() {
  printf '%s' "${WORKTREE_PARENT_DIR:-..}"
}

resolve_worktree_prefix() {
  if [[ -n "${WORKTREE_PREFIX:-}" ]]; then
    printf '%s' "$WORKTREE_PREFIX"
  else
    local proj
    proj="$(basename "$(pwd)")"
    printf '%s-wt-' "$proj"
  fi
}

resolve_claude_bin() {
  printf '%s' "${CLAUDE_BIN:-claude}"
}

resolve_tmux_env_args() {
  # Build `-e KEY=VAL` args for `tmux new-session` so env vars the per-window
  # claude needs are forwarded into the new tmux session. Without this, tmux
  # filters out custom env on session creation and child claude instances
  # cannot see e.g. `CLAUDE_ONESHOT_LOG_DIR` set by the coordinator.
  #
  # Hardcoded allowlist (always propagated when set):
  #   - CLAUDE_ONESHOT_LOG_DIR  (session-manager log path convention)
  #
  # Operator extension: `TMUX_PASS_ENV` is a whitespace-separated list of
  # additional env var names to propagate. Each name must satisfy
  # `validate_identifier`, and each value must satisfy `validate_env_value`.
  local args=""
  local keys=("CLAUDE_ONESHOT_LOG_DIR")
  local extra_keys=()
  if [[ -n "${TMUX_PASS_ENV:-}" ]]; then
    read -r -a extra_keys <<< "${TMUX_PASS_ENV}"
  fi
  local key
  for key in "${extra_keys[@]+"${extra_keys[@]}"}"; do
    validate_env_var_name "$key"
    keys+=("$key")
  done
  for key in "${keys[@]}"; do
    # Single read of the indirect-expanded value, then validate, then append.
    # Reading twice (`${!key:-}` here and again on the append line) would
    # widen a theoretical TOCTOU window and obscure the audit trail; this
    # form keeps validation and use of the value adjacent.
    local val="${!key:-}"
    if [[ -n "$val" ]]; then
      validate_env_value "$key" "$val"
      args+=" -e '${key}=${val}'"
    fi
  done
  printf '%s' "$args"
}

cmd_start() {
  if [[ $# -lt 2 ]]; then
    echo "Error: start requires <feature_branch> and at least one <slug>" >&2
    usage >&2
    exit 2
  fi
  local feat="$1"
  validate_branch_name "$feat"
  shift
  local session parent prefix claude perm
  session="$(resolve_session_name)"
  parent="$(resolve_worktree_parent_dir)"
  prefix="$(resolve_worktree_prefix)"
  claude="$(resolve_claude_bin)"
  perm="${CLAUDE_PERMISSION_MODE:-acceptEdits}"
  validate_permission_mode "$perm"
  local model_flag=""
  if [[ -n "${CLAUDE_MODEL:-}" ]]; then
    validate_identifier "CLAUDE_MODEL" "$CLAUDE_MODEL"
    model_flag="--model $CLAUDE_MODEL"
  fi

  local tmux_env_args
  tmux_env_args="$(resolve_tmux_env_args)"
  emit "tmux new-session -d${tmux_env_args} -s '$session' -n coordinator"
  local slug wt branch
  for slug in "$@"; do
    validate_identifier "slug" "$slug"
    wt="${parent}/${prefix}${slug}"
    branch="feature/${feat}-${slug}"
    emit "git worktree add '$wt' -b '$branch' '$feat'"
    emit "tmux new-window -t '$session' -n '$slug' \"cd '$wt' && $claude -n '$slug' $model_flag --permission-mode $perm\""
  done
  emit "tmux select-window -t '$session':0"
  echo
  echo "Started session '$session' with $# windows: $*"
}

cmd_stop() {
  local session="${1:-$(resolve_session_name)}"
  emit "tmux kill-session -t '$session'"
}

cmd_status() {
  local session="${1:-$(resolve_session_name)}"
  emit "tmux list-windows -t '$session'"
}

cmd_attach() {
  if [[ $# -lt 1 ]]; then
    echo "Error: attach requires a <slug>" >&2
    usage >&2
    exit 2
  fi
  local slug="$1"
  validate_identifier "slug" "$slug"
  local session="${2:-$(resolve_session_name)}"
  # `tmux attach` blocks until the user detaches, so chaining
  # `tmux attach ... \; select-window ...` would only run select-window
  # after the user exits. Use `select-window` first (or `switch-client`
  # if already inside a tmux session) so the target window is active
  # before the attach happens.
  if [[ -n "${TMUX:-}" ]]; then
    emit "tmux switch-client -t '$session:$slug'"
  else
    emit "tmux select-window -t '$session:$slug' && tmux attach -t '$session'"
  fi
}

main() {
  local subcmd=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        subcmd="$1"
        shift
        break
        ;;
    esac
  done

  case "$subcmd" in
    start) cmd_start "$@" ;;
    stop) cmd_stop "$@" ;;
    status) cmd_status "$@" ;;
    attach) cmd_attach "$@" ;;
    "")
      usage
      ;;
    *)
      echo "Unknown subcommand: $subcmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
