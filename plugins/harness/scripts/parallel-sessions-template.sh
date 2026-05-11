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
  # Used for: CLAUDE_MODEL alias.
  local name="$1"
  local val="$2"
  if [[ ! "$val" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Error: $name '$val' contains invalid characters (allowed: a-z A-Z 0-9 . _ -)" >&2
    exit 2
  fi
}

validate_slug() {
  # tmux target syntax uses "." to separate window and pane, so slug/window
  # names must not contain dots if we target panes as "${session}:${slug}".
  # It also tries numeric indexes before exact window names, so avoid leading
  # digits.
  local val="$1"
  if [[ ! "$val" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
    echo "Error: slug '$val' contains invalid characters (allowed: leading a-z A-Z _, then a-z A-Z 0-9 _ -; dot and leading digits are reserved by tmux target syntax)" >&2
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
  CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS    (default 20; total wait budget, auto-raised to cover every worker probe)
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
# Background: when the parallel-worktree-v2 launcher spawns `claude -n <slug>`
# and the coordinator immediately drives `/tdd-implement` into the worker via
# `tmux send-keys`, the user-level overlay (`~/.claude/`) skill catalog may
# not yet have registered inside the new REPL. The typeahead then sees an
# empty catalog and the slash command is delivered as a plain prompt. This is
# the overlay-load race (early-prompt misclassification); it has been observed
# empirically across consumer deployments as a recurring 4-worker simultaneous
# BLOCK pattern in consecutive parallel batches.
#
# Four-stage mitigation:
#   Stage 1: baseline sleep (CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS) so the
#            overlay finishes loading before any probe.
#   Stage 2: send `/help` and scan `capture-pane` for the six required skill
#            identifiers.
#   Stage 3: on probe failure, inject the 8-field BLOCKED final-report
#            prompt via `tmux send-keys` so the coordinator can switch to a
#            takeover path.
#   Stage 4: the `cmd_verify` subcommand lets an operator re-run the probe on
#            a live session.

# Default list of six required skills; override with CLAUDE_REQUIRED_SKILLS.
__DEFAULT_REQUIRED_SKILLS=(
  "harness:tdd-implement"
  "harness:codex-sync"
  "harness:pseudo-coderabbit-loop"
  "harness:coderabbit-review"
  "harness:codex-team"
  "harness:session-handoff"
)

resolve_required_skills() {
  # Honor CLAUDE_REQUIRED_SKILLS if set; otherwise return the default six.
  # Adversarial review fix (token validation): reject control chars / shell
  # metacharacters / whitespace within a single token so a poisoned env value
  # cannot break the missing-skill output (which is whitespace-joined into the
  # escalation prompt) or sneak past `grep -F`. Allow alphanumerics, `:`, `_`,
  # `.`, `/`, `-` so namespaced identifiers like `harness:tdd-implement` work.
  if [[ -n "${CLAUDE_REQUIRED_SKILLS:-}" ]]; then
    # 2-stage validation:
    # (a) Raw value: reject control chars (newline / tab / CR / etc.) which
    #     bash word-splitting would silently consume as separators, so a
    #     per-token regex below cannot see them. Plain space is the only
    #     allowed separator. shell metacharacters (`;` `&` `|` `$` etc.) are
    #     caught by the per-token regex in stage (b).
    # (b) Per-token: enforce [A-Za-z0-9._:/-]+ so each identifier survives
    #     unmodified through grep -F + escalation prompt interpolation.
    if [[ "$CLAUDE_REQUIRED_SKILLS" =~ [[:cntrl:]] ]]; then
      echo "Warning: CLAUDE_REQUIRED_SKILLS contains control characters (newline / tab / CR); using defaults" >&2
      local IFS=' '
      printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
      return 0
    fi
    local tokens=()
    # Use `read -a` instead of `for tok in $CLAUDE_REQUIRED_SKILLS`: the latter
    # performs filename expansion, so a value like `*` can become repository
    # paths before the token regex sees it.
    local IFS=' '
    read -r -a tokens <<< "$CLAUDE_REQUIRED_SKILLS"
    local tok
    for tok in "${tokens[@]}"; do
      if [[ ! "$tok" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
        echo "Warning: CLAUDE_REQUIRED_SKILLS token '$tok' rejected (allowed chars: A-Z a-z 0-9 . _ : / -); using defaults" >&2
        local IFS=' '
        printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
        return 0
      fi
    done
    if [[ ${#tokens[@]} -eq 0 ]]; then
      echo "Warning: CLAUDE_REQUIRED_SKILLS contains no skill tokens; using defaults" >&2
      local IFS=' '
      printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
      return 0
    fi
    local IFS=' '
    printf '%s' "${tokens[*]}"
  else
    # join with single space
    local IFS=' '
    printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
  fi
}

check_skill_registry_in_output() {
  # Pure function: scan the pane-content string for each required skill and
  # emit any missing identifier on stdout, one per line. Returns rc=0 when
  # all required skills are present, rc=1 when at least one is missing.
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
  # Build the 8-field BLOCKED final-report prompt that is injected when the
  # overlay-load race is detected. Keep the injected prompt itself one logical
  # line for `tmux send-keys`, but require the worker's final report to use the
  # canonical newline-separated field schema parsed by the coordinator.
  # Args: $1 = slug (worker identifier)
  #       $2 = missing_skills (whitespace-separated single string)
  local slug="$1"
  local missing="$2"
  printf 'OVERLAY_LOAD_TIMEOUT detected by launcher (overlay-load race) for slug=%s. ' "$slug"
  printf 'Required harness skills not loaded: [%s]. ' "$missing"
  printf 'STOP all work. Output the final report as exactly 8 newline-separated fields, one field per line, using this schema: '
  printf '[1] STATUS: BLOCKED '
  printf '[2] CHANGED_FILES: (none) '
  printf '[3] COMMIT: (none) '
  printf '[4] PUSHED_BRANCH: (none) '
  printf '[5] VALIDATION: SKIPPED '
  printf '[6] BLOCKERS: harness overlay load timeout (overlay-load race) - skills missing [%s] ' "$missing"
  printf '[7] NEXT_ACTION: (escalate to coordinator for parallel-agent takeover) '
  printf '[8] FORBIDDEN_ACTIONS_USED: no\n'
}

probe_skill_registry() {
  # Send a /help probe, capture pane content, and poll until every required
  # skill identifier appears in the visible pane. Emits the missing-skill list
  # (newline-separated) on stdout when verification fails; empty stdout + rc=0
  # on full success; rc=1 on poll timeout with missing skills; rc=2 when tmux
  # itself fails (session/window gone) so the caller can distinguish that
  # failure mode from "skills not yet loaded".
  # Args: $1 = session name
  #       $2 = slug
  #       $3 = required skills list, whitespace-separated (optional, default
  #            = resolve_required_skills)
  #       $4 = probe timeout in seconds (optional, default reads
  #            CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS; integer-validated)
  local session="$1"
  local slug="$2"
  local required="${3:-$(resolve_required_skills)}"
  local timeout="${4:-${CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS:-12}}"

  # CR review fix: when the caller does not pass an explicit (already-
  # validated) timeout we re-read the env var and must integer-validate it
  # here too. Without this, `cmd_verify` (which calls probe_skill_registry
  # directly) and any future direct caller could inject "abc" via the env and
  # break the poll loop. wait_for_all_workers_ready passes its sanitized
  # local probe_timeout as $4 so this branch is a no-op in that path.
  if ! [[ "$timeout" =~ ^[0-9]+$ ]]; then
    echo "Warning: CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS='$timeout' is not an integer; defaulting to 12" >&2
    timeout=12
  fi

  local before_output
  if ! before_output=$(tmux capture-pane -t "${session}:${slug}" -p 2>/dev/null); then
    printf 'tmux capture-pane failed\n'
    return 2
  fi

  # Adversarial review fix (stale-content false-positive): record the visible
  # pane before `/help`, then scan only the output appended by this probe.
  # `tmux clear-history` does not clear the visible screen, and `C-l` is a best-
  # effort REPL key rather than a tmux-level guarantee, so snapshot exclusion is
  # the real guard against old text satisfying a fresh registry check.
  tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
  tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
  tmux send-keys -t "${session}:${slug}" C-l 2>/dev/null || true
  tmux clear-history -t "${session}:${slug}" 2>/dev/null || true

  # Send `/help` to trigger the built-in skill-list rendering; the trailing
  # Enter submits it.
  if ! tmux send-keys -t "${session}:${slug}" -- "/help" Enter 2>/dev/null; then
    # tmux send-keys failed (session/window gone) — surface to caller.
    printf 'tmux send-keys failed\n'
    return 2
  fi

  local elapsed=0
  local missing_output=""
  while [[ $elapsed -lt $timeout ]]; do
    sleep 2
    elapsed=$((elapsed + 2))
    local output
    local capture_rc=0
    # Adversarial review fix (capture failure detection): distinguish a real
    # empty pane from a tmux failure. Without this, a killed window would be
    # treated as "no skills loaded" which is technically true but the proper
    # signal is "session gone" (rc=2) so the caller doesn't pointlessly inject
    # an escalation prompt to a dead pane.
    if output=$(tmux capture-pane -t "${session}:${slug}" -p 2>/dev/null); then
      capture_rc=0
    else
      capture_rc=$?
    fi
    if [[ $capture_rc -ne 0 ]]; then
      printf 'tmux capture-pane failed\n'
      return 2
    fi
    local scan_output="$output"
    if [[ "$output" == "$before_output"* ]]; then
      scan_output="${output#"$before_output"}"
    fi
    if missing_output=$(check_skill_registry_in_output "$scan_output" "$required"); then
      # rc=0: all present. Clear /help screen with Escape so subsequent
      # prompts (e.g. /tdd-implement) don't conflict with help overlay.
      tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
      return 0
    fi
  done
  # Poll timeout reached: emit the last-known missing-skill list and rc=1.
  printf '%s\n' "$missing_output"
  return 1
}

escalate_blocked_to_slug() {
  # On verification failure, inject the BLOCKED 8-field directive via
  # tmux send-keys. Send Escape first to dismiss any open typeahead / help
  # overlay so the message is delivered to a clean prompt.
  # Args: $1 = session, $2 = slug, $3 = missing skills (whitespace-joined)
  local session="$1"
  local slug="$2"
  local missing="$3"
  tmux send-keys -t "${session}:${slug}" Escape 2>/dev/null || true
  sleep 1
  local msg
  msg=$(build_blocked_escalation_message "$slug" "$missing")
  # Use `--` to terminate option parsing so tmux never reinterprets a leading
  # dash or future option-like prefix in `$msg` as a flag.
  tmux send-keys -t "${session}:${slug}" -- "$msg" Enter 2>/dev/null || true
}

wait_for_all_workers_ready() {
  # Run Stage 1 (baseline sleep) followed by Stage 2 (per-slug probe) across
  # all just-spawned slugs. Failed slugs go through Stage 3 escalation and
  # are recorded in $__VERIFY_FAILED_SLUGS (consumable by the caller after
  # cmd_start returns).
  # Opt-out path: CLAUDE_OVERLAY_LOAD_VERIFY=0 → return 0 immediately with no
  # sleeps and no tmux interaction.
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
  local probe_timeout="${CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS:-12}"

  # Numeric guard: validate_env_value alone does not enforce an integer
  # invariant. Adversarial review follow-up: apply the same integer check to
  # CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS.
  if ! [[ "$min_wait" =~ ^[0-9]+$ ]] || ! [[ "$max_wait" =~ ^[0-9]+$ ]]; then
    echo "Warning: CLAUDE_OVERLAY_LOAD_(MIN|MAX)_WAIT_SECONDS must be integers; defaulting to 5/20" >&2
    min_wait=5
    max_wait=20
  fi
  if ! [[ "$probe_timeout" =~ ^[0-9]+$ ]]; then
    echo "Warning: CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS must be integer; defaulting to 12" >&2
    probe_timeout=12
  fi
  # Adversarial review fix (enforce MAX_WAIT_SECONDS without false-skipping
  # later workers): probe_skill_registry polls in 2s chunks, so a timeout of 1
  # still spends up to 2 real seconds. max_wait must cover the baseline plus
  # one real probe ceiling per slug. If the operator set max_wait too low, raise
  # it so every worker receives at least one probe before any MAX_WAIT branch
  # can fire.
  local probe_poll_interval=2
  local probe_budget=0
  if [[ "$probe_timeout" -gt 0 ]]; then
    probe_budget=$(( ((probe_timeout + probe_poll_interval - 1) / probe_poll_interval) * probe_poll_interval ))
  fi
  local required_max=$((min_wait + probe_budget * ${#slugs[@]}))
  if [[ "$max_wait" -lt "$required_max" ]]; then
    echo "Warning: CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=$max_wait < (MIN_WAIT $min_wait + PROBE_BUDGET $probe_budget * WORKERS ${#slugs[@]}); raising to $required_max" >&2
    max_wait=$required_max
  fi

  echo "[verify] waiting ${min_wait}s baseline for overlay (~/.claude/) load..." >&2
  sleep "$min_wait"

  __VERIFY_FAILED_SLUGS=()
  local slug
  local started_at="$SECONDS"
  for slug in "${slugs[@]}"; do
    # Enforce MAX_WAIT total ceiling per cmd_start invocation.
    local elapsed=$((SECONDS - started_at + min_wait))
    if [[ "$elapsed" -ge "$max_wait" ]]; then
      echo "[verify] '$slug' SKIPPED - MAX_WAIT $max_wait exceeded (elapsed ${elapsed}s); marking as failed" >&2
      __VERIFY_FAILED_SLUGS+=("$slug")
      if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
        escalate_blocked_to_slug "$session" "$slug" "(verify skipped: max-wait ceiling reached)"
      fi
      continue
    fi
    echo "[verify] probing skill registry for '$slug'..." >&2
    local missing
    local probe_rc=0
    # Pass the validated probe_timeout (and required-skills resolver result)
    # into probe_skill_registry so it does not re-read the unvalidated env var.
    missing=$(probe_skill_registry "$session" "$slug" "$(resolve_required_skills)" "$probe_timeout" 2>/dev/null) || probe_rc=$?
    if [[ $probe_rc -eq 0 ]]; then
      echo "[verify] '$slug' OK (all required skills present)" >&2
    elif [[ $probe_rc -eq 2 ]]; then
      # tmux failure: pane / session gone. Do NOT attempt to escalate (would
      # silently fail and mis-report). Mark failed and let caller decide.
      echo "[verify] '$slug' UNREACHABLE - tmux capture/send failed (session/window gone?); skipping escalation" >&2
      __VERIFY_FAILED_SLUGS+=("$slug")
    else
      echo "[verify] '$slug' FAILED - missing skills: ${missing//$'\n'/ }" >&2
      __VERIFY_FAILED_SLUGS+=("$slug")
      if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
        escalate_blocked_to_slug "$session" "$slug" "${missing//$'\n'/ }"
        echo "[verify] '$slug' escalation injected (BLOCKED 8-field)" >&2
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
  local requested_slugs=("$@")
  local slug
  for slug in "${requested_slugs[@]}"; do
    validate_slug "$slug"
  done

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
  local wt branch
  local spawned_slugs=()
  for slug in "${requested_slugs[@]}"; do
    wt="${parent}/${prefix}${slug}"
    branch="feature/${feat}-${slug}"
    emit "git worktree add '$wt' -b '$branch' '$feat'"
    emit "tmux new-window -t '$session' -n '$slug' \"cd '$wt' && $claude -n '$slug' $model_flag --permission-mode $perm\""
    spawned_slugs+=("$slug")
  done
  emit "tmux select-window -t '$session':0"

  # Skill-registry verify (overlay-load race guard). Skipped on dry-run or
  # when CLAUDE_OVERLAY_LOAD_VERIFY=0.
  # Adversarial review fix (CRITICAL): surface a verify failure as a non-zero
  # exit code so the coordinator hears about it. The previous implementation
  # only printed a warning and returned 0, which meant CLAUDE_SKILL_VERIFY_
  # ESCALATE=0 or an escalation send-keys failure produced a launcher exit 0
  # while the registry was still unloaded — the coordinator would then send
  # /tdd-implement straight into the very race this guard is meant to prevent.
  if [[ $DRY_RUN -eq 0 ]]; then
    if ! wait_for_all_workers_ready "$session" "${spawned_slugs[@]}"; then
      echo "Error: skill-registry verify failed for slugs: ${__VERIFY_FAILED_SLUGS[*]}" >&2
      if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
        echo "       BLOCKED escalation prompts have been injected (Stage 3)." >&2
      else
        echo "       (Stage 3 escalation skipped because CLAUDE_SKILL_VERIFY_ESCALATE != 1)" >&2
      fi
      echo "       Coordinator MUST check this exit code (3) before sending the initial /tdd-implement prompt." >&2
      echo "       Run \`$0 verify '$session'\` for an operator repush probe." >&2
      echo
      echo "Started session '$session' with $# windows: $* (verify FAILED, exit=3)"
      exit 3
    fi
  fi

  echo
  echo "Started session '$session' with $# windows: $*"
}

cmd_verify() {
  # Operator-driven repush probe (Stage 4). Re-runs the skill-registry probe
  # against every worker in an existing session (or only the listed slugs)
  # and injects an escalation prompt on any failed slug.
  # exit code: 0 = all OK, 2 = usage error, 3 = verify failed for >=1 slug.
  local session="${1:-}"
  if [[ -z "$session" ]]; then
    echo "Error: verify requires a session name as the first arg" >&2
    usage >&2
    exit 2
  fi
  shift

  # Slugs argument: when omitted, discover every window name in the session
  # and exclude the coordinator window.
  local slugs=()
  if [[ $# -gt 0 ]]; then
    local s
    for s in "$@"; do
      validate_slug "$s"
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
    local probe_rc=0
    missing=$(probe_skill_registry "$session" "$slug" 2>/dev/null) || probe_rc=$?
    if [[ $probe_rc -eq 0 ]]; then
      echo "[verify] '$slug' OK"
    elif [[ $probe_rc -eq 2 ]]; then
      # Mirror wait_for_all_workers_ready: tmux capture/send failed → window
      # is gone, escalation injection would silently no-op. Mark failed but do
      # NOT attempt escalate.
      echo "[verify] '$slug' UNREACHABLE - tmux capture/send failed (session/window gone?); skipping escalation" >&2
      failed+=("$slug")
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
  validate_slug "$slug"
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
# When this file is sourced (for example by a unit-test harness that calls
# helper functions directly) main() must not run. `BASH_SOURCE[0] == $0` is
# only true when the launcher is executed via `bash <path>`; test runners
# source the file and invoke the helpers without triggering main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
