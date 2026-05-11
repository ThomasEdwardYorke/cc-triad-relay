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
  parallel-sessions-template.sh [--dry-run] verify <session_name> [<slug1> [slug2 ...]]
  parallel-sessions-template.sh --help

Subcommands:
  start    Create N git worktrees + N tmux windows + N independent claude sessions.
           After spawn, waits for overlay (~/.claude/) skill load + probes the
           harness skill registry per slug, then sends a structured BLOCKED
           8-field escalation prompt to any window whose skill registry is
           incomplete (overlay-load race guard). Disable per-session with
           CLAUDE_OVERLAY_LOAD_VERIFY=0.
  stop     Kill the tmux session (no worktree cleanup).
  status   Print tmux windows + per-worktree git log -1.
  attach   Attach to the tmux session and select a slug's window.
  verify   Re-run the skill-registry probe on a live session (operator-driven
           repush path). Useful after `attach` reveals an early-prompt race
           that `start` did not catch.

Flags:
  --dry-run  Print the planned commands without executing tmux / git / claude.
  --help     Show this help.

Env vars:
  TMUX_SESSION_NAME                       (default: harness-parallel)
  WORKTREE_PARENT_DIR                     (default: parent of cwd, i.e. ..)
  WORKTREE_PREFIX                         (default: <project>-wt-, derived from cwd basename)
  CLAUDE_BIN                              (default: claude)
  CLAUDE_MODEL                            (optional, passed as claude --model <alias>)
  CLAUDE_PERMISSION_MODE                  (default: acceptEdits)
  CLAUDE_ONESHOT_LOG_DIR                  (optional, forwarded to tmux session via `-e`)
  TMUX_PASS_ENV                           (optional, whitespace-separated extra env var
                                           names to forward via `-e`)
  CLAUDE_OVERLAY_LOAD_VERIFY              (default 1; set 0 to skip wait+verify, e.g. mock-claude tests)
  CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS    (default 5; baseline sleep after spawn before any probe)
  CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS    (default 20; max total wait incl. baseline + ready poll)
  CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS     (default 12; max wait for /help probe output to populate)
  CLAUDE_SKILL_VERIFY_ESCALATE            (default 1; set 0 to skip BLOCKED prompt injection on failure)
  CLAUDE_REQUIRED_SKILLS                  (default 6 harness skills; whitespace-separated list)

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

# --- Skill-registry verify helpers (overlay-load race guard) --------------
# 背景: parallel-worktree-v2 launcher が `claude -n <slug>` を spawn 直後に
# coordinator が `/tdd-implement` を tmux send-keys しても、user-level overlay
# (~/.claude/) の skill catalog が REPL runtime に load される前なら typeahead
# が空判定し、slash command が plain prompt として送信される。これが
# overlay-load race (early-prompt misclassification) の真因で、observed in
# multiple consumer deployments と consecutive parallel batches 4-worker 同時
# BLOCK の empirical pattern として再現する.
#
# 対策 4 段階:
#   Stage 1: baseline sleep (CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS) で overlay
#            load 完了待ち
#   Stage 2: /help プローブ + capture-pane で 6 必須 skill の存在を検証
#   Stage 3: 検証失敗時に 8-section BLOCKED final report 指示を tmux send-keys
#            で injection (coordinator は escalate hint 受領後に takeover 経路へ)
#   Stage 4: cmd_verify subcommand で operator が手動 repush 可能

# 6 必須 skill の default. 上書きは CLAUDE_REQUIRED_SKILLS で実施.
__DEFAULT_REQUIRED_SKILLS=(
  "harness:tdd-implement"
  "harness:codex-sync"
  "harness:pseudo-coderabbit-loop"
  "harness:coderabbit-review"
  "harness:codex-team"
  "harness:session-handoff"
)

resolve_required_skills() {
  # Env override が設定済なら最優先. 未設定なら default 6 skill を返す.
  if [[ -n "${CLAUDE_REQUIRED_SKILLS:-}" ]]; then
    printf '%s' "$CLAUDE_REQUIRED_SKILLS"
  else
    # join with single space
    local IFS=' '
    printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
  fi
}

check_skill_registry_in_output() {
  # Pure function: 与えられた pane content 文字列に対し required skill list を
  # 走査し、欠落 skill 名を stdout に 1 行ずつ出力. 欠落ゼロなら rc=0、
  # 一件以上欠落なら rc=1.
  # Args: $1 = output (multiline string)
  #       $2 = required skills (whitespace-separated single string)
  local output="$1"
  local required="$2"
  local missing=()
  local skill
  local flat
  if [[ -z "$required" ]]; then
    return 0
  fi
  # tmux capture-pane wraps long lines at the terminal width, which can split
  # a skill identifier like `harness:tdd-implement` across a newline (e.g.
  # `harness:\ntdd-implement`). Strip newlines entirely (NOT replace with
  # space — a space breaks the literal match too) so wrapped identifiers still
  # match `grep -qF`.
  flat=$(printf '%s' "$output" | tr -d '\n')
  for skill in $required; do
    if ! printf '%s' "$flat" | grep -qF -- "$skill"; then
      missing+=("$skill")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "${missing[@]}"
  return 1
}

build_blocked_escalation_message() {
  # overlay-load race 検出時の 8-section BLOCKED final report 文面を組み立てる.
  # tmux send-keys で 1 prompt として injection するため改行禁止. delimiter
  # は `;` に統一.
  # Args: $1 = slug (worker 識別子)
  #       $2 = missing_skills (whitespace-separated single string)
  local slug="$1"
  local missing="$2"
  printf 'OVERLAY_LOAD_TIMEOUT detected by launcher (overlay-load race) for slug=%s. ' "$slug"
  printf 'Required harness skills not loaded: [%s]. ' "$missing"
  printf 'STOP all work. Output the 8-field final report exactly as: '
  printf 'STATUS: BLOCKED; '
  printf 'CHANGED_FILES: (none); '
  printf 'COMMIT: (none); '
  printf 'PUSHED_BRANCH: (none); '
  printf 'VALIDATION: SKIPPED; '
  printf 'BLOCKERS: harness overlay load timeout (overlay-load race) - skills missing [%s]; ' "$missing"
  printf 'NEXT_ACTION: (escalate to coordinator for parallel-agent takeover); '
  printf 'FORBIDDEN_ACTIONS_USED: no.\n'
}

probe_skill_registry() {
  # /help プローブを送信して pane content を回収し、必須 skill が出揃うまで
  # poll. stdout に欠落 skill (改行区切り) を出力、すべて揃っていれば空出力 +
  # rc=0、最終 timeout で欠落残るなら rc=1.
  # Args: $1 = session name
  #       $2 = slug
  #       $3 = required skills (optional, default = resolve_required_skills)
  local session="$1"
  local slug="$2"
  local required="${3:-$(resolve_required_skills)}"
  local timeout="${CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS:-12}"

  # send `/help` to trigger built-in skill list rendering. 末尾 Enter で確定.
  tmux send-keys -t "${session}:${slug}" "/help" Enter 2>/dev/null || {
    # tmux failure (session/window missing) を上位に伝える.
    printf 'tmux send-keys failed\n'
    return 2
  }

  local elapsed=0
  local missing_output=""
  while [[ $elapsed -lt $timeout ]]; do
    sleep 2
    elapsed=$((elapsed + 2))
    local output
    # -S -300 で過去 300 行まで遡って capture (skill list が長い場合への保険)
    output=$(tmux capture-pane -t "${session}:${slug}" -p -S -300 2>/dev/null || echo "")
    if missing_output=$(check_skill_registry_in_output "$output" "$required"); then
      # rc=0: all present. Clear /help screen with Escape so subsequent
      # prompts (e.g. /tdd-implement) don't conflict with help overlay.
      tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
      return 0
    fi
  done
  # timeout に達した. 直近の missing list を出力して rc=1.
  printf '%s\n' "$missing_output"
  return 1
}

escalate_blocked_to_slug() {
  # 検証失敗時に BLOCKED 8-section 指示を tmux send-keys で injection.
  # 事前に Escape を送って typeahead / help overlay を閉じてから本文を送る.
  # Args: $1 = session, $2 = slug, $3 = missing skills (whitespace-joined)
  local session="$1"
  local slug="$2"
  local missing="$3"
  tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
  sleep 1
  local msg
  msg=$(build_blocked_escalation_message "$slug" "$missing")
  # Use `--` to terminate option parsing so tmux never reinterprets a leading
  # dash or future option-like prefix in `$msg` as a flag. The 8-section
  # escalation message contains literal `;` delimiters which are safe inside
  # the quoted arg, but `--` is the belt-and-suspenders guard across tmux
  # versions.
  tmux send-keys -t "${session}:${slug}" -- "$msg" Enter 2>/dev/null || true
}

wait_for_all_workers_ready() {
  # spawn 直後の全 slug を順に Stage 1 (baseline sleep) + Stage 2 (probe) で
  # 検証. 検証失敗 slug は Stage 3 escalate を実行し $__VERIFY_FAILED_SLUGS
  # に登録する (coordinator が cmd_start 後に参照可能).
  # opt-out: CLAUDE_OVERLAY_LOAD_VERIFY=0 → 即 return 0 (sleep ゼロ).
  # Args: $1 = session, $2... = slugs
  local session="$1"
  shift
  local slugs=("$@")

  # Opt-out (test / mock-claude / operator override)
  if [[ "${CLAUDE_OVERLAY_LOAD_VERIFY:-1}" != "1" ]]; then
    return 0
  fi
  if [[ ${#slugs[@]} -eq 0 ]]; then
    return 0
  fi

  local min_wait="${CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS:-5}"
  local max_wait="${CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS:-20}"

  # Numeric guard (validate_env_value だけでは整数 invariant を保証しない)
  if ! [[ "$min_wait" =~ ^[0-9]+$ ]] || ! [[ "$max_wait" =~ ^[0-9]+$ ]]; then
    echo "Warning: CLAUDE_OVERLAY_LOAD_(MIN|MAX)_WAIT_SECONDS must be integers; defaulting to 5/20" >&2
    min_wait=5
    max_wait=20
  fi

  echo "[verify] waiting ${min_wait}s baseline for overlay (~/.claude/) load..." >&2
  sleep "$min_wait"

  __VERIFY_FAILED_SLUGS=()
  local slug
  for slug in "${slugs[@]}"; do
    echo "[verify] probing skill registry for '$slug'..." >&2
    local missing
    if missing=$(probe_skill_registry "$session" "$slug" 2>/dev/null); then
      echo "[verify] '$slug' OK (all required skills present)" >&2
    else
      echo "[verify] '$slug' FAILED - missing skills: ${missing//$'\n'/ }" >&2
      __VERIFY_FAILED_SLUGS+=("$slug")
      if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
        escalate_blocked_to_slug "$session" "$slug" "${missing//$'\n'/ }"
        echo "[verify] '$slug' escalation injected (BLOCKED 8-section)" >&2
      fi
    fi
  done

  if [[ ${#__VERIFY_FAILED_SLUGS[@]} -gt 0 ]]; then
    return 1
  fi
  return 0
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
  # `validate_env_var_name`, and each value must satisfy `validate_env_value`.
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
    # Detect "is set" independent of value emptiness.
    # `${!key:-}` collapses unset and empty-string into the same observable
    # state, so an operator who explicitly sets `MY_VAR=""` to override an
    # inherited (e.g. leaked) value cannot propagate that intent through to
    # the child tmux session. `${!key+set}` returns the literal `set` only
    # when the variable is set, which lets us forward `-e KEY=` for the
    # set-but-empty case while still skipping unset keys.
    if [[ "${!key+set}" == "set" ]]; then
      local val="${!key}"
      # Only run the path-safe regex when there is a value to validate.
      # Empty string is intentionally allowed and produces `-e KEY=` so
      # that `unset(KEY)` semantics survive the launcher → tmux boundary.
      if [[ -n "$val" ]]; then
        validate_env_value "$key" "$val"
      fi
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
  local spawned_slugs=()
  for slug in "$@"; do
    validate_identifier "slug" "$slug"
    wt="${parent}/${prefix}${slug}"
    branch="feature/${feat}-${slug}"
    emit "git worktree add '$wt' -b '$branch' '$feat'"
    emit "tmux new-window -t '$session' -n '$slug' \"cd '$wt' && $claude -n '$slug' $model_flag --permission-mode $perm\""
    spawned_slugs+=("$slug")
  done
  emit "tmux select-window -t '$session':0"

  # Skill-registry verify (overlay-load race guard). dry-run / opt-out では skip.
  # Failure 時も非 fatal で進める (escalate prompt が tmux に注入済、operator が
  # `verify` subcommand で repush 可能). exit 0 を維持して既存の orchestrator
  # チェーンを壊さない設計.
  if [[ $DRY_RUN -eq 0 ]]; then
    if wait_for_all_workers_ready "$session" "${spawned_slugs[@]}"; then
      :
    else
      echo "Warning: skill-registry verify failed for slugs: ${__VERIFY_FAILED_SLUGS[*]}" >&2
      echo "         BLOCKED escalation prompts have been injected (Stage 3)." >&2
      echo "         Run \`$0 verify '$session'\` for an operator repush probe." >&2
    fi
  fi

  echo
  echo "Started session '$session' with $# windows: $*"
}

cmd_verify() {
  # Operator-driven repush probe (Stage 4). 既存 session 内の全 worker (or
  # 指定 slugs) に対して skill registry を再 probe し、失敗時は escalate を
  # injection する.
  # exit code: 0 = all OK, 2 = usage error, 3 = verify failed for >=1 slug.
  local session="${1:-}"
  if [[ -z "$session" ]]; then
    echo "Error: verify requires a session name as the first arg" >&2
    usage >&2
    exit 2
  fi
  shift

  # Slugs 引数: 省略時は session 内の全 window 名から coordinator を除外して採用
  local slugs=()
  if [[ $# -gt 0 ]]; then
    local s
    for s in "$@"; do
      validate_identifier "slug" "$s"
      slugs+=("$s")
    done
  else
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "[dry-run] would discover slugs via: tmux list-windows -t '$session' -F '#W'"
      return 0
    fi
    local windows_out
    windows_out=$(tmux list-windows -t "$session" -F '#W' 2>&1) || {
      echo "Error: tmux session '$session' not found or not accessible: $windows_out" >&2
      exit 2
    }
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == "coordinator" ]] && continue
      slugs+=("$line")
    done <<< "$windows_out"
    if [[ ${#slugs[@]} -eq 0 ]]; then
      echo "Error: no candidate slug windows found in session '$session' (only coordinator?)" >&2
      exit 2
    fi
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] would probe skill registry for slugs in '$session': ${slugs[*]}"
    return 0
  fi

  local failed=()
  local slug
  for slug in "${slugs[@]}"; do
    echo "[verify] probing '$slug'..." >&2
    local missing
    if missing=$(probe_skill_registry "$session" "$slug" 2>/dev/null); then
      echo "[verify] '$slug' OK"
    else
      echo "[verify] '$slug' FAILED - missing: ${missing//$'\n'/ }" >&2
      failed+=("$slug")
      if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
        escalate_blocked_to_slug "$session" "$slug" "${missing//$'\n'/ }"
        echo "[verify] '$slug' escalation injected" >&2
      fi
    fi
  done

  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "verify: ${#failed[@]} slug(s) failed: ${failed[*]}" >&2
    exit 3
  fi
  echo "verify: all ${#slugs[@]} slug(s) OK"
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
    verify) cmd_verify "$@" ;;
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

# --- Sourced-mode guard ---------------------------------------------------
# Source されたとき (例: 単体テストが helper 関数を呼ぶ場合) は main を起動
# しない. `BASH_SOURCE[0]` が `$0` と一致するのは launcher を直接 bash で
# 実行した場合のみ. test 側は本ファイルを source し、関数を直接 invoke する.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
