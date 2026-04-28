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
# All values that flow into `bash -c "$*"` (via emit) or into tmux command
# strings MUST pass through one of these validators. They reject any value
# containing shell metacharacters, command separators, or quote escapes that
# could break out of the surrounding context.

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

  emit "tmux new-session -d -s '$session' -n coordinator"
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
