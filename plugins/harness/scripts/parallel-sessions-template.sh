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
GENERATED_BRANCH_RECORD_FILE="harness-generated-branch"
GENERATED_SESSION_RECORD_FILE="harness-session-name"

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

validate_tmux_session_name() {
  # Session names flow into single-quoted tmux targets inside emit strings.
  # Keep the same target-safe subset as slugs, while allowing the default
  # hyphenated session name (`harness-parallel`).
  local val="$1"
  if [[ ! "$val" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
    echo "Error: tmux session name '$val' contains invalid characters (allowed: leading a-z A-Z _, then a-z A-Z 0-9 _ -)" >&2
    exit 2
  fi
}

validate_pane_title() {
  # Safe subset emitted by session-manager idle pane helpers:
  # the canonical slug title or a convenience label such as <slug>-IDLE-12m.
  # This value flows into `tmux select-pane -T`; keep it shell-safe.
  local val="$1"
  if [[ ! "$val" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
    echo "Error: pane title '$val' contains invalid characters (allowed: leading a-z A-Z _, then a-z A-Z 0-9 _ -)" >&2
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

# --- Layer 3 plugin-discovery helpers (auto-install) ----------------------
# Background: parallel-worktree-v2 spawns a fresh top-level claude REPL per
# worktree. Without project-scoped plugin install, the REPL only sees user-
# scope plugins (~/.claude/plugins/) and the harness skill catalog appears
# empty. Layer 3 closes this by reading the consumer's tracked
# `.claude/settings.json` (Layer 1 invariant) and emitting
# `claude plugin install <plugin>@<marketplace> --scope=project` for every
# `enabledPlugins[*] === true` key, BEFORE the worker tmux window spawns.
# All helpers respect the existing `emit` / `DRY_RUN` contract so the unit
# tests can assert on emitted commands without invoking real `claude` /
# `git` / `tmux`.

resolve_enabled_plugins() {
  # Parse `<settings_path>` JSON and emit one `name@marketplace` per line for
  # every `enabledPlugins[*] === true` key. Pure read: no install side effect.
  # Args: $1 = absolute path to settings.json.
  # Exit: 0 (ok or no enabledPlugins) / 1 (missing file) / 2 (python3 absent) /
  #       3 (malformed JSON).
  # Why python3 (not jq): jq would add a homebrew-only external dep; python3
  # ships with macOS and is in every linux distro the harness targets. argv
  # passes the path as a literal so shell metachars in $1 cannot escape into
  # the inline script.
  local settings_path="$1"
  if [[ ! -f "$settings_path" ]]; then
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for plugin discovery but is not on PATH" >&2
    return 2
  fi
  # Distinguish JSON parse errors from generic exceptions so the operator can
  # tell "file is corrupted" from "Python itself failed". Both still exit 3
  # (the bash caller treats any non-zero rc here as "could not list plugins")
  # but the stderr message points at the right thing.
  python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except json.JSONDecodeError as exc:
    sys.stderr.write("Error: settings.json malformed JSON at line {} col {}: {}\n".format(
        exc.lineno, exc.colno, exc.msg))
    sys.exit(3)
except OSError as exc:
    sys.stderr.write("Error: settings.json could not be read: {}\n".format(exc))
    sys.exit(3)
except Exception as exc:
    sys.stderr.write("Error: unexpected exception while reading settings.json: {}: {}\n".format(
        type(exc).__name__, exc))
    sys.exit(3)
plugins = data.get("enabledPlugins", {})
if not isinstance(plugins, dict):
    sys.exit(0)
for key, val in plugins.items():
    if val is True:
        print(key)
' "$settings_path"
}

resolve_handoff_copy_sources() {
  # Split HANDOFF_COPY_SOURCES (colon-separated ABSOLUTE paths) and emit one
  # normalized path per line. Empty / unset env → no output, rc=0.
  # Args: none (reads HANDOFF_COPY_SOURCES env).
  # Exit: 0 (ok or empty) / 1 (any entry rejected as relative).
  # Why colon-separated: existing validate_env_value charset
  # `[a-zA-Z0-9._/=:@,+-]+` already allows `:`. Using it as IFS keeps the env
  # value compatible with `tmux new-session -e KEY=VAL` propagation if a
  # downstream consumer ever forwards HANDOFF_COPY_SOURCES into the worker
  # environment (not done by default, but future-safe).
  # Note: each entry is realpath-normalized via
  # `cd "$(dirname ...)" && pwd -P` which FOLLOWS SYMLINKS to the canonical
  # target. This is intentional (operators may symlink handoff sources from a
  # central drop point) but means the function will silently widen the actual
  # filesystem reach beyond what the literal env string suggests. Per the
  # operator-trust-boundary at the top of this file, callers are responsible
  # for not pointing HANDOFF_COPY_SOURCES at symlinks they do not vouch for.
  # Note: filesystems allow `:` in path components (HFS+ / ext4 both permit
  # it). Because IFS=':' is the chosen separator, operators MUST NOT place
  # paths containing literal colons here — the loop below would split such
  # paths mid-component and reject the fragments as relative. This
  # restriction is documented in `usage()`.
  local raw="${HANDOFF_COPY_SOURCES:-}"
  if [[ -z "$raw" ]]; then
    return 0
  fi
  local IFS=':'
  local entry
  for entry in $raw; do
    [[ -z "$entry" ]] && continue
    if [[ "$entry" != /* ]]; then
      echo "Error: HANDOFF_COPY_SOURCES entry '$entry' must be an ABSOLUTE path" >&2
      return 1
    fi
    if [[ ! -e "$entry" ]]; then
      echo "Warning: HANDOFF_COPY_SOURCES entry '$entry' does not exist (skipping)" >&2
      continue
    fi
    # realpath-style normalization without depending on coreutils `realpath`.
    # macOS ships `readlink -f` only in coreutils homebrew; bash + cd -P is
    # portable. Fail-soft on cd error (returns rc=1 to caller).
    local real_dir
    real_dir=$(cd "$(dirname "$entry")" 2>/dev/null && pwd -P) || {
      echo "Error: HANDOFF_COPY_SOURCES entry '$entry' could not be resolved" >&2
      return 1
    }
    printf '%s/%s\n' "$real_dir" "$(basename "$entry")"
  done
}

copy_handoff_sources_to_worktree() {
  # Copy every HANDOFF_COPY_SOURCES entry into $1 via `emit "cp -RP ..."`.
  # No-op when env is empty. Used by cmd_start AFTER git worktree add and
  # BEFORE plugin install so the worktree path exists. Fail-fast on
  # resolve_handoff_copy_sources errors so the caller (cmd_start) can abort
  # the spawn cleanly instead of silently skipping malformed entries.
  # Args: $1 = worktree path (absolute or relative; passed through to cp).
  # Exit: 0 (ok or no entries) / 1 (resolve_handoff_copy_sources rc != 0,
  #       e.g. a relative path entry rejected).
  #
  # Why capture-then-read instead of process substitution: the previous form
  # `done < <(resolve_handoff_copy_sources)` could not propagate the
  # function's rc to the caller — a malformed entry produced a stderr
  # warning but the while loop saw an empty stream and continued silently.
  # Capturing into `$sources` lets us observe the rc via `|| rc=$?` and
  # return it to cmd_start.
  #
  # Why `cp -RP` (preserve symlinks) instead of `cp -r` (default follow):
  # resolve_handoff_copy_sources already normalizes the ENTRY path via
  # `cd && pwd -P` (dereferences operator-supplied symlinks at the top
  # level). However, if the entry is a directory whose subtree contains
  # symlinks to outside paths (e.g. a `link-to-secret -> /etc/private`
  # inside an otherwise innocent handoff directory), BSD `cp -r` on macOS
  # FOLLOWS those nested symlinks by default and materializes the targets
  # inside the worktree — a silent data-exfiltration vector that bypasses
  # the operator-trust boundary documented at the top of this file. `-RP`
  # preserves the symlink as-is so the worktree mirrors the source tree
  # literally; operators who genuinely want a flattened copy must either
  # pre-flatten with their own command or set up the link target before
  # invoking the launcher.
  local wt_path="$1"
  if [[ -z "${HANDOFF_COPY_SOURCES:-}" ]]; then
    return 0
  fi
  local sources
  local rc=0
  sources=$(resolve_handoff_copy_sources) || rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "Error: copy_handoff_sources_to_worktree aborted (resolve_handoff_copy_sources rc=$rc)" >&2
    return "$rc"
  fi
  local src
  while IFS= read -r src; do
    [[ -z "$src" ]] && continue
    emit "cp -RP '$src' '${wt_path}/'"
  done <<< "$sources"
}

install_plugins_for_worktree() {
  # For every `enabledPlugins[*] === true` key in `<wt>/.claude/settings.json`,
  # emit `claude plugin install <key> --scope=project` executed inside the
  # worktree directory. Fail-fast on invalid plugin name format.
  # Args: $1 = worktree path, $2 = settings.json path (default = $1/.claude/settings.json).
  # Exit: 0 (ok or skipped because settings.json absent — non-fatal for
  #       generic consumers) / 1 (resolve_enabled_plugins error or invalid
  #       plugin name).
  # Why skip-on-missing-settings: this template is generic (a `<project>`
  # placeholder template), not consumer-specific. A consumer without
  # `.claude/settings.json` should not be forced into Layer 3. The skip emits
  # a stderr INFO so an operator can confirm the path was reached.
  local wt_path="$1"
  local settings_path="${2:-${wt_path}/.claude/settings.json}"
  if [[ ! -f "$settings_path" ]]; then
    echo "[plugin-install] '$wt_path' SKIPPED — settings.json not found at $settings_path" >&2
    return 0
  fi
  local plugins
  local resolve_rc=0
  # `tr -d '\r'` strips Windows CRLF endings emitted by python3 print() under
  # Git Bash for Windows, so that the per-plugin `while IFS= read -r plugin`
  # loop below does not capture a trailing `\r` and reject every plugin
  # identifier as malformed via the strict regex.
  plugins=$(resolve_enabled_plugins "$settings_path" | tr -d '\r') || resolve_rc=$?
  if [[ $resolve_rc -ne 0 ]]; then
    echo "[plugin-install] '$wt_path' FAILED — resolve_enabled_plugins rc=$resolve_rc" >&2
    return 1
  fi
  if [[ -z "$plugins" ]]; then
    echo "[plugin-install] '$wt_path' no enabled plugins (skip)" >&2
    return 0
  fi
  # Use the operator-resolved CLAUDE_BIN (same binary that worker tmux windows
  # spawn) so a non-default claude binary path is honoured here too. This is a
  # functional requirement: hard-coding `claude` here would ignore
  # cmd_start's resolve_claude_bin() usage for worker spawn.
  local claude_bin
  claude_bin=$(resolve_claude_bin)
  local plugin
  while IFS= read -r plugin; do
    [[ -z "$plugin" ]] && continue
    # Plugin name format: <name>@<marketplace>. Same charset as
    # validate_identifier but with a single `@` separator. Reject anything
    # else so a hostile / malformed settings.json cannot inject shell
    # metachars through the single-quoted `emit` interpolation.
    if [[ ! "$plugin" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]]; then
      echo "[plugin-install] '$wt_path' FAILED — invalid plugin identifier '$plugin'" >&2
      return 1
    fi
    echo "[plugin-install] '$wt_path' installing '$plugin'..." >&2
    emit "cd '$wt_path' && $claude_bin plugin install '$plugin' --scope=project"
  done <<< "$plugins"
}

usage() {
  cat <<'USAGE'
parallel-sessions-template.sh — tmux-based parallel-session launcher

Usage:
  parallel-sessions-template.sh [--dry-run] start <feature_branch> <slug1> [slug2 ...]
  parallel-sessions-template.sh [--dry-run] stop    [<session_name>]
  parallel-sessions-template.sh [--dry-run] stop    --rollback [<session_name>] [<slug1> ...]
  parallel-sessions-template.sh [--dry-run] cleanup [<session_name>] [<slug1> ...]
  parallel-sessions-template.sh [--dry-run] status  [<session_name>]
  parallel-sessions-template.sh [--dry-run] attach  <slug> [<session_name>]
  parallel-sessions-template.sh [--dry-run] verify  <session_name> [<slug1> [slug2 ...]]
  parallel-sessions-template.sh [--dry-run] label-panes <session_name> <slug=title> [slug=title ...]
  parallel-sessions-template.sh --help

Subcommands:
  start    Create N git worktrees + N tmux windows + N independent claude sessions.
           For each worktree, optionally copy HANDOFF_COPY_SOURCES into it then
           auto-install every plugin enabled in `<wt>/.claude/settings.json`
           (`enabledPlugins` keys with value === true) via
           `claude plugin install <plugin>@<marketplace> --scope=project`. Fail-
           fast on any install error (exit 3) so the coordinator does not send
           prompts into an unloaded REPL.
           After spawn, waits for overlay (~/.claude/) skill load + probes the
           harness skill registry per slug, then sends a structured BLOCKED
           8-field escalation prompt to any window whose skill registry is
           incomplete (overlay-load race guard). Disable per-session with
           CLAUDE_OVERLAY_LOAD_VERIFY=0.
  stop     Kill the tmux session (no worktree cleanup, no plugin uninstall).
           With --rollback, explicitly delegates to cleanup: stop the tmux
           session, remove generated worktrees, and delete generated
           recorded feature/*-<slug>
           branches discovered from each worktree before removal. This is a
           destructive recovery path and requires the operator to pass
           --rollback. In dry-run rollback mode, pass explicit slugs because
           dry-run does not inspect live tmux / git state.
  cleanup  Per-slug `claude plugin uninstall --scope=project -y` + `git worktree
           remove --force` + generated branch cleanup + tmux kill-session.
           When no slug args are given, discovers slugs from tmux window names
           (excludes the coordinator window). When explicit slugs are given
           (test / operator override), uses those instead of tmux discovery.
           In --dry-run cleanup / rollback mode, explicit slugs are required
           because dry-run does not inspect live tmux / git state.
  status   Print tmux windows + per-worktree git log -1.
  attach   Attach to the tmux session and select a slug's window.
  verify   Re-run the skill-registry probe on a live session (operator-driven
           repush path). Useful after `attach` reveals an early-prompt race
           that `start` did not catch.
  label-panes
           Apply deterministic tmux pane labels generated from
           session-manager summaries, for example `api=api-IDLE-12m`.
           This is convenience-only; the session-manager dashboard remains
           the canonical idle / hung status view.

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
  HANDOFF_COPY_SOURCES                    (optional, colon-separated ABSOLUTE paths to
                                           copy into each worktree before tmux spawn.
                                           Example: HANDOFF_COPY_SOURCES="/a/handoff.md:/b/x"
                                           IMPORTANT: paths must NOT contain colons (colon
                                           is reserved as the entry separator). Each entry
                                           is realpath-normalized via `cd && pwd -P` and
                                           follows symlinks; operator is responsible for
                                           the entries pointing only at trusted content.
                                           IMPORTANT (Layer 3 interaction): consumers using
                                           Layer 3 plugin auto-install should either commit
                                           `.claude/settings.json` into the repo (so the
                                           freshly-created worktree already has it) OR add
                                           an absolute path that lands a settings.json
                                           inside the worktree via this env. Otherwise
                                           install_plugins_for_worktree() will skip silently
                                           and the overlay-load race guard becomes the only
                                           safety net.)
  CLAUDE_OVERLAY_LOAD_VERIFY              (default 1; set 0 to skip wait+verify, e.g. mock-claude tests)
  CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS    (default 5; baseline sleep after spawn before any probe)
  CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS    (default 20; total wait budget, auto-raised to cover every worker probe)
  CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS     (default 12; max wait for /help probe output to populate, minimum 2)
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

print_attach_operator_help() {
  local session="$1"
  local slug="$2"
  local script_name
  script_name="$(basename "$0")"
  {
    echo "[tmux quickref] ${script_name} attach '$slug' '$session' selects worker '$slug'."
    echo "[tmux quickref] Detach without stopping work: Ctrl-b d"
    echo "[tmux quickref] List windows: tmux list-windows -t '$session'"
    echo "[tmux quickref] Capture pane: tmux capture-pane -p -t '$session:$slug.0'"
    echo "[tmux quickref] Re-check after attach: ${script_name} verify '$session' '$slug'"
  } >&2
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
    local token_count=0
    # Split on spaces while temporarily disabling filename expansion. A plain
    # `for tok in $CLAUDE_REQUIRED_SKILLS` would otherwise expand `*` into
    # repository paths before the token regex sees it, while `read -a` exits
    # non-zero for whitespace-only input on older Bash under `set -e`.
    local IFS=' '
    local had_noglob=0
    case "$-" in
      *f*) had_noglob=1 ;;
    esac
    set -f
    local tok
    for tok in $CLAUDE_REQUIRED_SKILLS; do
      tokens+=("$tok")
      token_count=$((token_count + 1))
    done
    if [[ "$had_noglob" -eq 0 ]]; then
      set +f
    fi
    if [[ "$token_count" -eq 0 ]]; then
      echo "Warning: CLAUDE_REQUIRED_SKILLS contains no skill tokens; using defaults" >&2
      local IFS=' '
      printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
      return 0
    fi
    for tok in "${tokens[@]}"; do
      if [[ ! "$tok" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
        echo "Warning: CLAUDE_REQUIRED_SKILLS token '$tok' rejected (allowed chars: A-Z a-z 0-9 . _ : / -); using defaults" >&2
        local IFS=' '
        printf '%s' "${__DEFAULT_REQUIRED_SKILLS[*]}"
        return 0
      fi
    done
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
  local spaced
  local token_stream
  if [[ -z "$required" ]]; then
    return 0
  fi
  # tmux capture-pane wraps long lines at the terminal width, which can split
  # a skill identifier like `harness:tdd-implement` across a newline (e.g.
  # `harness:\ntdd-implement`). Strip newlines entirely (NOT replace with
  # space — a space breaks the literal match too) so wrapped identifiers still
  # match `grep -qF`.
  flat=$(printf '%s' "$output" | tr -d '\n')
  spaced=$(printf '%s' "$output" | tr '\n' ' ')
  # Match exact command/skill tokens instead of substrings so
  # `harness:tdd-implementation` does not satisfy `harness:tdd-implement`.
  # `/help` commonly renders slash commands with a leading "/" while required
  # skills are configured without it, so accept either exact token form.
  token_stream=$(
    {
      printf '%s\n' "$spaced"
      printf '%s\n' "$flat"
    } | tr -cs 'A-Za-z0-9._:/-' '\n'
  )
  for skill in $required; do
    if ! printf '%s\n' "$token_stream" | grep -qxF -- "$skill" &&
       ! printf '%s\n' "$token_stream" | grep -qxF -- "/$skill"; then
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
  local poll_interval=2
  if [[ "$timeout" -lt "$poll_interval" ]]; then
    echo "Warning: CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS='$timeout' < poll interval ${poll_interval}; raising to ${poll_interval}" >&2
    timeout=$poll_interval
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
  local probe_poll_interval=2
  if [[ "$probe_timeout" -lt "$probe_poll_interval" ]]; then
    echo "Warning: CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS=$probe_timeout < poll interval ${probe_poll_interval}; raising to ${probe_poll_interval}" >&2
    probe_timeout=$probe_poll_interval
  fi
  # Adversarial review fix (enforce MAX_WAIT_SECONDS without false-skipping
  # later workers): probe_skill_registry polls in 2s chunks, so a timeout of 1
  # still spends up to 2 real seconds. max_wait must cover the baseline plus
  # one real probe ceiling per slug. If the operator set max_wait too low, raise
  # it so every worker receives at least one probe before any MAX_WAIT branch
  # can fire.
  local probe_budget=0
  if [[ "$probe_timeout" -gt 0 ]]; then
    probe_budget=$(( ((probe_timeout + probe_poll_interval - 1) / probe_poll_interval) * probe_poll_interval ))
  fi
  local escalation_budget=0
  if [[ "${CLAUDE_SKILL_VERIFY_ESCALATE:-1}" == "1" ]]; then
    escalation_budget=1
  fi
  local required_max=$((min_wait + (probe_budget + escalation_budget) * ${#slugs[@]}))
  if [[ "$max_wait" -lt "$required_max" ]]; then
    echo "Warning: CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=$max_wait < (MIN_WAIT $min_wait + (PROBE_BUDGET $probe_budget + ESCALATION_BUDGET $escalation_budget) * WORKERS ${#slugs[@]}); raising to $required_max" >&2
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
  local session="${TMUX_SESSION_NAME:-harness-parallel}"
  validate_tmux_session_name "$session"
  printf '%s' "$session"
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

generated_record_dir() {
  local wt="$1"
  git -C "$wt" rev-parse --git-dir 2>/dev/null
}

generated_branch_record_path() {
  local wt="$1"
  local record_dir
  record_dir=$(generated_record_dir "$wt") || return 1
  printf '%s/%s' "$record_dir" "$GENERATED_BRANCH_RECORD_FILE"
}

generated_session_record_path() {
  local wt="$1"
  local record_dir
  record_dir=$(generated_record_dir "$wt") || return 1
  printf '%s/%s' "$record_dir" "$GENERATED_SESSION_RECORD_FILE"
}

record_generated_branch_for_cleanup() {
  local wt="$1"
  local branch="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    emit "rollback_git_dir=\$(git -C '$wt' rev-parse --git-dir) && printf '%s\n' '$branch' > \"\${rollback_git_dir}/$GENERATED_BRANCH_RECORD_FILE\""
    return 0
  fi

  local record_path
  if ! record_path=$(generated_branch_record_path "$wt"); then
    echo "Error: cannot resolve git dir for rollback branch record in '$wt'" >&2
    return 1
  fi
  printf '%s\n' "$branch" > "$record_path"
}

record_generated_session_for_cleanup() {
  local wt="$1"
  local session="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    emit "rollback_git_dir=\$(git -C '$wt' rev-parse --git-dir) && printf '%s\n' '$session' > \"\${rollback_git_dir}/$GENERATED_SESSION_RECORD_FILE\""
    return 0
  fi

  local record_path
  if ! record_path=$(generated_session_record_path "$wt"); then
    echo "Error: cannot resolve git dir for rollback session record in '$wt'" >&2
    return 1
  fi
  printf '%s\n' "$session" > "$record_path"
}

read_generated_branch_record_for_cleanup() {
  local wt="$1"
  local record_path
  record_path=$(generated_branch_record_path "$wt") || return 1
  [[ -f "$record_path" ]] || return 1
  head -n 1 "$record_path"
}

read_generated_session_record_for_cleanup() {
  local wt="$1"
  local record_path
  record_path=$(generated_session_record_path "$wt") || return 1
  [[ -f "$record_path" ]] || return 1
  head -n 1 "$record_path"
}

is_safe_generated_branch_for_cleanup() {
  local val="$1"
  local slug="$2"
  local recorded="$3"
  [[ -n "$recorded" ]] || return 1
  [[ "$val" == "$recorded" ]] || return 1
  [[ "$val" == feature/* ]] || return 1
  [[ "$val" == *-"$slug" ]] || return 1
  [[ "$val" =~ ^[a-zA-Z0-9._/-]+$ ]] || return 1
  [[ "$val" != *..* ]] || return 1
  [[ "$val" != -* ]] || return 1
  return 0
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
    local had_noglob=0
    case "$-" in
      *f*) had_noglob=1 ;;
    esac
    set -f
    local extra_key
    for extra_key in $TMUX_PASS_ENV; do
      extra_keys+=("$extra_key")
    done
    if [[ "$had_noglob" -eq 0 ]]; then
      set +f
    fi
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

rollback_started_worktrees() {
  local parent="$1"
  local prefix="$2"
  local current_slug="$3"
  shift 3

  local cleanup_slug cleanup_wt
  for cleanup_slug in "${@+"$@"}"; do
    cleanup_wt="${parent}/${prefix}${cleanup_slug}"
    emit_rollback_worktree_cleanup "$cleanup_wt" "$cleanup_slug"
  done

  cleanup_wt="${parent}/${prefix}${current_slug}"
  emit_rollback_worktree_cleanup "$cleanup_wt" "$current_slug"
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
    record_generated_branch_for_cleanup "$wt" "$branch"
    record_generated_session_for_cleanup "$wt" "$session"
    # Layer 3 — order matters: handoff doc copy must run before plugin install
    # (some consumers reference handoff path from a plugin postinstall hook in
    # theory), and plugin install must run before tmux spawns so the new REPL
    # sees project-scoped plugins on launch. dry-run flows through `emit` so
    # the unit-test golden output captures every command without executing it.
    if ! copy_handoff_sources_to_worktree "$wt"; then
      echo "Error: handoff copy failed for worktree '$wt' (Layer 3)" >&2
      rollback_started_worktrees "$parent" "$prefix" "$slug" "${spawned_slugs[@]}"
      tmux kill-session -t "$session" 2>/dev/null || true
      exit 3
    fi
    if [[ $DRY_RUN -eq 0 ]]; then
      if ! install_plugins_for_worktree "$wt"; then
        echo "Error: plugin install failed for worktree '$wt' (Layer 3)" >&2
        echo "       Coordinator MUST stop before sending the initial /tdd-implement prompt." >&2
        rollback_started_worktrees "$parent" "$prefix" "$slug" "${spawned_slugs[@]}"
        # tmux new-session at the top of cmd_start has already created the
        # session, but only some worker windows are added. Kill the half-spawned
        # session so the next `start` invocation does not collide on
        # "Session already exists" + so the operator does not need to manually
        # clean up. `|| true` because the session may already be gone if an
        # earlier-loop slug failed mid-add.
        tmux kill-session -t "$session" 2>/dev/null || true
        exit 3
      fi
    else
      # dry-run emits all install commands even if real-mode would fail-fast on
      # the first error. This is intentional: dry-run exists to preview the
      # full command stream, not to model error pathways.
      install_plugins_for_worktree "$wt" || true
    fi
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
  validate_tmux_session_name "$session"
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

emit_rollback_worktree_cleanup() {
  # Remove one generated worktree and then delete the generated local branch
  # that was checked out inside it. The branch is captured before
  # `git worktree remove` because Git cannot report the checked-out branch
  # from a path after the worktree is gone.
  #
  # Branch deletion is intentionally restricted to `feature/*-<slug>`: this
  # template creates `feature/<feature_branch>-<slug>` branches, and rollback
  # must never infer that an arbitrary manually-created feature branch is safe
  # to delete just because it happened to be checked out in the worktree. The
  # current branch must also match the gitdir marker recorded immediately after
  # `git worktree add`.
  # `git branch -D -- "$branch"` keeps a branch value from being parsed as an
  # option even though validate_branch_name already rejects leading dashes.
  local wt="$1"
  local slug="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    emit "rollback_git_dir=\$(git -C '$wt' rev-parse --git-dir 2>/dev/null || true); rollback_recorded_branch=\"\"; if [[ -n \"\$rollback_git_dir\" && -f \"\${rollback_git_dir}/$GENERATED_BRANCH_RECORD_FILE\" ]]; then rollback_recorded_branch=\$(head -n 1 \"\${rollback_git_dir}/$GENERATED_BRANCH_RECORD_FILE\"); fi; rollback_branch=\$(git -C '$wt' branch --show-current 2>/dev/null || true); if [[ -d '$wt' ]]; then git worktree remove '$wt' --force; if [[ -n \"\$rollback_branch\" && \"\$rollback_branch\" == \"\$rollback_recorded_branch\" && \"\$rollback_branch\" == feature/* && \"\$rollback_branch\" == *-'$slug' ]]; then git branch -D -- \"\$rollback_branch\"; else echo \"[cleanup] skip branch delete for '$wt' (branch not recorded generated feature/*-<slug>: \${rollback_branch:-none})\" >&2; fi; else echo \"[cleanup] worktree '$wt' missing (skip)\" >&2; fi"
    return 0
  fi

  if [[ ! -d "$wt" ]]; then
    echo "[cleanup] worktree '$wt' missing (skip)" >&2
    return 0
  fi

  local rollback_branch=""
  local recorded_branch=""
  rollback_branch=$(git -C "$wt" branch --show-current 2>/dev/null || true)
  recorded_branch=$(read_generated_branch_record_for_cleanup "$wt" 2>/dev/null || true)
  emit "git worktree remove '$wt' --force"

  if [[ -z "$rollback_branch" ]]; then
    echo "[cleanup] skip branch delete for '$wt' (branch not found)" >&2
    return 0
  fi
  if [[ -z "$recorded_branch" ]]; then
    echo "[cleanup] skip branch delete for '$wt' (generated branch record not found)" >&2
    return 0
  fi
  if ! is_safe_generated_branch_for_cleanup "$rollback_branch" "$slug" "$recorded_branch"; then
    echo "[cleanup] skip branch delete for '$wt' (branch not recorded safe feature/*-<slug> for slug '$slug': $rollback_branch)" >&2
    return 0
  fi
  emit "git branch -D -- '$rollback_branch'"
}

cmd_stop() {
  if [[ "${1:-}" == "--rollback" ]]; then
    shift
    cmd_cleanup "$@"
    return 0
  fi
  if [[ $# -gt 1 ]]; then
    echo "Error: stop accepts at most one <session_name> unless --rollback is specified" >&2
    usage >&2
    exit 2
  fi
  local session="${1:-$(resolve_session_name)}"
  validate_tmux_session_name "$session"
  emit "tmux kill-session -t '$session'"
}

cmd_cleanup() {
  # Symmetric counterpart to cmd_start: per-slug `claude plugin uninstall
  # --scope=project -y` + `git worktree remove --force` + generated branch
  # cleanup + final tmux kill-session. Kept separate from default cmd_stop so
  # the existing tmux-kill-only contract (used by older callers and CI smoke
  # tests) is unchanged unless the operator explicitly passes `stop --rollback`
  # or calls `cleanup`.
  #
  # Slug discovery:
  #   - With explicit slug args (`cleanup <session> <slug1> [slug2 ...]`),
  #     use those (test path + operator override path).
  #   - Without explicit slugs, query tmux for windows in <session> and skip
  #     the `coordinator` window. Requires the tmux session to still be
  #     alive at cleanup time (parallel-worktree-v2 squashes merge BEFORE
  #     kill so this is the common flow).
  #
  # dry-run mode forwards everything through `emit`, so the unit tests can
  # assert on the emitted command sequence without invoking real tmux / git
  # / claude.
  local session="${1:-$(resolve_session_name)}"
  validate_tmux_session_name "$session"
  if [[ $# -gt 0 ]]; then
    shift
  fi
  local explicit_slugs=("$@")
  if [[ $DRY_RUN -eq 1 && ${#explicit_slugs[@]} -eq 0 ]]; then
    echo "Error: dry-run rollback cleanup requires explicit slugs; dry-run does not inspect live tmux / git state" >&2
    exit 2
  fi

  local parent prefix
  parent="$(resolve_worktree_parent_dir)"
  prefix="$(resolve_worktree_prefix)"

  local slugs=()
  if [[ ${#explicit_slugs[@]} -gt 0 ]]; then
    local s wt recorded_session
    for s in "${explicit_slugs[@]}"; do
      validate_slug "$s"
      wt="${parent}/${prefix}${s}"
      if [[ $DRY_RUN -eq 0 && -d "$wt" ]]; then
        recorded_session=$(read_generated_session_record_for_cleanup "$wt" 2>/dev/null || true)
        if [[ "$recorded_session" != "$session" ]]; then
          echo "[cleanup] skip worktree '$wt' (session record mismatch: ${recorded_session:-none})" >&2
          continue
        fi
      fi
      slugs+=("$s")
    done
  elif [[ $DRY_RUN -eq 0 ]]; then
    # Primary: discover from tmux window names.
    local windows_out
    windows_out=$(tmux list-windows -t "$session" -F '#W' 2>/dev/null) || windows_out=""
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == "coordinator" ]] && continue
      if [[ "$line" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
        slugs+=("$line")
      else
        echo "[cleanup] skip unsafe tmux window name '$line'" >&2
      fi
    done <<< "$windows_out"
    # Fallback: when the tmux session is already gone the primary discovery
    # returns an empty list and the cleanup would silently leak every worktree
    # + project-scoped plugin install. Fall back to
    # `git worktree list --porcelain` and extract <slug> from worktree paths
    # that match the launcher's `${parent}/${prefix}` naming convention.
    # `base` is captured once so the prefix-strip parameter expansion can
    # quote it via `${wt_path#"$base"}` (avoids ShellCheck SC2295 — without
    # the inner quotes, a literal `*` / `?` / `[` inside ${parent} or
    # ${prefix} would be treated as a glob pattern).
    if [[ ${#slugs[@]} -eq 0 ]]; then
      echo "[cleanup] tmux session '$session' unreachable; falling back to git worktree list" >&2
      local base="${parent}/${prefix}"
      local base_abs="$base"
      if [[ "$parent" != /* ]]; then
        local parent_abs
        if parent_abs=$(cd "$parent" 2>/dev/null && pwd -P); then
          base_abs="${parent_abs}/${prefix}"
        fi
      fi
      local wt_line wt_path slug_from_path recorded_session
      while IFS= read -r wt_line; do
        [[ "$wt_line" =~ ^worktree[[:space:]]+(.+)$ ]] || continue
        wt_path="${BASH_REMATCH[1]}"
        if [[ "$wt_path" == "$base_abs"* ]]; then
          slug_from_path="${wt_path#"$base_abs"}"
        elif [[ "$wt_path" == "$base"* ]]; then
          slug_from_path="${wt_path#"$base"}"
        else
          continue
        fi
        if [[ "$slug_from_path" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
          recorded_session=$(read_generated_session_record_for_cleanup "$wt_path" 2>/dev/null || true)
          if [[ "$recorded_session" != "$session" ]]; then
            echo "[cleanup] skip worktree '$wt_path' (session record mismatch: ${recorded_session:-none})" >&2
            continue
          fi
          slugs+=("$slug_from_path")
        else
          echo "[cleanup] skip unsafe worktree slug '$slug_from_path' from path '$wt_path'" >&2
        fi
      done < <(git worktree list --porcelain 2>/dev/null || true)
    fi
  fi

  local slug wt
  for slug in "${slugs[@]+"${slugs[@]}"}"; do
    wt="${parent}/${prefix}${slug}"
    # Uninstall every project-scoped plugin that the worktree's tracked
    # `.claude/settings.json` advertises. Skip silently when the worktree
    # path is gone (already removed) or settings.json is absent.
    if [[ -d "$wt" ]] && [[ -f "${wt}/.claude/settings.json" ]]; then
      local plugins
      # See install_plugins_for_worktree comment: `tr -d '\r'` is required to
      # strip Git Bash for Windows CRLF before the per-plugin loop matches the
      # regex.
      plugins=$(resolve_enabled_plugins "${wt}/.claude/settings.json" 2>/dev/null | tr -d '\r' || true)
      local plugin
      local claude_bin
      claude_bin=$(resolve_claude_bin)
      while IFS= read -r plugin; do
        [[ -z "$plugin" ]] && continue
        if [[ "$plugin" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$ ]]; then
          emit "cd '$wt' && $claude_bin plugin uninstall '$plugin' --scope=project -y"
        fi
      done <<< "$plugins"
    fi
    emit_rollback_worktree_cleanup "$wt" "$slug"
  done

  emit "tmux kill-session -t '$session' 2>/dev/null || true"

  if [[ ${#slugs[@]} -gt 0 ]]; then
    echo "Cleanup complete for session '$session' (slugs: ${slugs[*]})"
  else
    echo "Cleanup complete for session '$session' (no slugs discovered)"
  fi
}

cmd_status() {
  local session="${1:-$(resolve_session_name)}"
  validate_tmux_session_name "$session"
  emit "tmux list-windows -t '$session'"
}

cmd_label_panes() {
  if [[ $# -lt 2 ]]; then
    echo "Error: label-panes requires <session_name> and at least one <slug=title> mapping" >&2
    usage >&2
    exit 2
  fi
  local session="$1"
  validate_tmux_session_name "$session"
  shift
  local mapping slug title
  for mapping in "$@"; do
    if [[ "$mapping" != *=* ]]; then
      echo "Error: label-panes mapping '$mapping' must use <slug=title>" >&2
      exit 2
    fi
    slug="${mapping%%=*}"
    title="${mapping#*=}"
    validate_slug "$slug"
    validate_pane_title "$title"
  done

  for mapping in "$@"; do
    slug="${mapping%%=*}"
    title="${mapping#*=}"
    emit "tmux select-pane -t '$session:$slug.0' -T '$title'"
  done
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
  validate_tmux_session_name "$session"
  print_attach_operator_help "$session" "$slug"
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
    cleanup) cmd_cleanup "$@" ;;
    status) cmd_status "$@" ;;
    attach) cmd_attach "$@" ;;
    verify) cmd_verify "$@" ;;
    label-panes) cmd_label_panes "$@" ;;
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
