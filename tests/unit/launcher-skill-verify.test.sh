#!/usr/bin/env bash
#
# tests/unit/launcher-skill-verify.test.sh
#
# Unit tests for the skill-registry-verify helpers in
# `plugins/harness/scripts/parallel-sessions-template.sh`.
#
# 検証対象 (overlay-load race regression guard + reproducible multi-run scenario):
#   1. check_skill_registry_in_output   — pane 内 skill 名検出 (純粋関数)
#   2. resolve_required_skills          — env var / default の解決
#   3. build_blocked_escalation_message — 8-field BLOCKED 文面組立
#   4. cmd_verify                       — exit code + escalate 動作
#   5. wait_for_all_workers_ready (env disabled path) — opt-out 経路
#
# Sourced-mode 前提: launcher は `BASH_SOURCE[0] != $0` の場合 main を呼ばない。
# bash の `set -u` 下で source するため、関数定義のみ取り込む。
#
# Usage: bash tests/unit/launcher-skill-verify.test.sh
# Exit:  0 = all PASS, 1 = at least one FAIL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCHER="$REPO_ROOT/plugins/harness/scripts/parallel-sessions-template.sh"

if [[ ! -f "$LAUNCHER" ]]; then
  echo "FAIL: launcher not found: $LAUNCHER" >&2
  exit 1
fi

# --- Source launcher in non-main mode -------------------------------------
# `parallel-sessions-template.sh` の末尾は `main "$@"` を直接呼ぶ。
# Sourced-mode の場合に main を skip する guard が launcher 側に必要。
# 当 test は guard が実装されている前提で source する。
# shellcheck disable=SC1090
source "$LAUNCHER"

# --- Assertion helpers ----------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

assert_eq() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: $name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS+=("$name: expected='$expected' actual='$actual'")
    echo "  FAIL: $name"
    echo "    expected: '$expected'"
    echo "    actual:   '$actual'"
  fi
}

assert_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: $name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS+=("$name: needle='$needle' not in haystack")
    echo "  FAIL: $name (needle not found)"
    echo "    needle:   '$needle'"
    echo "    haystack: '$haystack'"
  fi
}

assert_not_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: $name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS+=("$name: needle='$needle' unexpectedly found in haystack")
    echo "  FAIL: $name (unexpected needle found)"
    echo "    needle:   '$needle'"
    echo "    haystack: '$haystack'"
  fi
}

assert_rc() {
  local name="$1"
  local expected_rc="$2"
  local actual_rc="$3"
  if [[ "$expected_rc" == "$actual_rc" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: $name (rc=$actual_rc)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS+=("$name: expected_rc=$expected_rc actual_rc=$actual_rc")
    echo "  FAIL: $name (expected_rc=$expected_rc actual_rc=$actual_rc)"
  fi
}

# --- Tests ----------------------------------------------------------------

echo "=== Test 1: check_skill_registry_in_output ==="

# 1a: 全 skill 存在 → return 0
out=$(check_skill_registry_in_output \
  "/harness:tdd-implement
/harness:codex-sync
/harness:pseudo-coderabbit-loop
/harness:coderabbit-review
/harness:codex-team
/harness:session-handoff
other content" \
  "harness:tdd-implement harness:codex-sync harness:pseudo-coderabbit-loop harness:coderabbit-review harness:codex-team harness:session-handoff" 2>&1) || rc=$?
rc="${rc:-0}"
assert_rc "1a all skills present → rc=0" "0" "$rc"
unset rc

# 1b: 一部 skill 欠落 → return 1 + 欠落 skill 名を stdout に出力
out=$(check_skill_registry_in_output \
  "/harness:tdd-implement
/harness:codex-sync" \
  "harness:tdd-implement harness:codex-sync harness:pseudo-coderabbit-loop" 2>&1) && rc=0 || rc=$?
assert_rc "1b some skills missing → rc=1" "1" "$rc"
assert_contains "1b missing skill listed (pseudo-coderabbit-loop)" "pseudo-coderabbit-loop" "$out"
unset rc out

# 1c: 全 skill 欠落 → return 1
out=$(check_skill_registry_in_output \
  "empty pane content" \
  "harness:tdd-implement" 2>&1) && rc=0 || rc=$?
assert_rc "1c all missing → rc=1" "1" "$rc"
assert_contains "1c missing skill listed (tdd-implement)" "tdd-implement" "$out"
unset rc out

# 1d: 空 required → return 0 (no-op)
out=$(check_skill_registry_in_output "anything" "" 2>&1) && rc=0 || rc=$?
assert_rc "1d empty required → rc=0" "0" "$rc"
unset rc out

# 1e: tmux line-wrap (skill split across newline) → still found (line-wrap regression guard)
wrapped=$(printf 'some prefix harness:\ntdd-implement and other text\nharness:codex-sync here\n')
out=$(check_skill_registry_in_output "$wrapped" "harness:tdd-implement harness:codex-sync") && rc=0 || rc=$?
assert_rc "1e line-wrap split skill found → rc=0" "0" "$rc"
unset rc out wrapped

# 1f: 部分一致 false-positive ガード (skill 名 prefix が含まれるが完全名は不在 → 欠落判定)
out=$(check_skill_registry_in_output \
  "harness:tdd-implementation typo only" \
  "harness:tdd-implement" 2>&1) && rc=0 || rc=$?
assert_rc "1f longer token does not satisfy required skill" "1" "$rc"
assert_contains "1f missing skill listed despite longer token" "harness:tdd-implement" "$out"
unset rc out

echo
echo "=== Test 2: resolve_required_skills ==="

# 2a: env var 未設定 → default 6 skill
unset CLAUDE_REQUIRED_SKILLS
out=$(resolve_required_skills)
assert_contains "2a default contains tdd-implement" "harness:tdd-implement" "$out"
assert_contains "2a default contains codex-sync" "harness:codex-sync" "$out"
assert_contains "2a default contains session-handoff" "harness:session-handoff" "$out"
unset out

# 2b: env var 設定 → override
export CLAUDE_REQUIRED_SKILLS="custom:a custom:b"
out=$(resolve_required_skills)
assert_eq "2b env override" "custom:a custom:b" "$out"
unset CLAUDE_REQUIRED_SKILLS out

# 2c: adversarial - invalid token (shell metachar) → fall back to defaults + warn
# (security regression guard against env-var injection).
export CLAUDE_REQUIRED_SKILLS='custom:safe; rm -rf /'
out=$(resolve_required_skills 2>/dev/null)
assert_contains "2c invalid token rejected, falls back to defaults (tdd-implement)" "harness:tdd-implement" "$out"
unset CLAUDE_REQUIRED_SKILLS out

# 2d: adversarial - whitespace inside token → reject + fall back
export CLAUDE_REQUIRED_SKILLS=$'custom:line1\ncustom:line2'
out=$(resolve_required_skills 2>/dev/null)
assert_contains "2d newline-in-token rejected, falls back to defaults" "harness:tdd-implement" "$out"
unset CLAUDE_REQUIRED_SKILLS out

# 2e: whitespace-only override → reject + fall back, not an empty verify set
export CLAUDE_REQUIRED_SKILLS='   '
out=$(resolve_required_skills 2>/dev/null)
assert_contains "2e whitespace-only override rejected, falls back to defaults" "harness:tdd-implement" "$out"
check_skill_registry_in_output "" "$out" >/dev/null 2>&1 && rc=0 || rc=$?
assert_rc "2e fallback default skills are still enforced" "1" "$rc"
unset CLAUDE_REQUIRED_SKILLS out rc

# 2f: glob metacharacter must be rejected before shell filename expansion
export CLAUDE_REQUIRED_SKILLS='*'
out=$(resolve_required_skills 2>/dev/null)
assert_contains "2f glob token rejected, falls back to defaults" "harness:tdd-implement" "$out"
assert_not_contains "2f glob token does not expand repository filenames" "CHANGELOG.md" "$out"
unset CLAUDE_REQUIRED_SKILLS out

# 2g: whitespace-only input must fall through to the empty-token fallback even
# with `set -e` active.
out=$(
  export CLAUDE_REQUIRED_SKILLS='   '
  set -e
  resolve_required_skills 2>/dev/null
)
assert_contains "2g whitespace-only falls back under set -e" "harness:tdd-implement" "$out"
unset out

echo
echo "=== Test 3: build_blocked_escalation_message ==="

# 3a: 必須 8-field 全部含む
msg=$(build_blocked_escalation_message "alpha" "harness:tdd-implement harness:codex-sync")
assert_contains "3a contains STATUS: BLOCKED" "STATUS: BLOCKED" "$msg"
assert_contains "3a contains CHANGED_FILES" "CHANGED_FILES" "$msg"
assert_contains "3a contains COMMIT: (none)" "COMMIT: (none)" "$msg"
assert_contains "3a contains PUSHED_BRANCH: (none)" "PUSHED_BRANCH: (none)" "$msg"
assert_contains "3a contains VALIDATION: SKIPPED" "VALIDATION: SKIPPED" "$msg"
assert_contains "3a contains BLOCKERS (overlay-load race)" "overlay-load race" "$msg"
assert_contains "3a contains missing skills listed" "harness:tdd-implement" "$msg"
assert_contains "3a contains NEXT_ACTION" "NEXT_ACTION" "$msg"
assert_contains "3a contains FORBIDDEN_ACTIONS_USED: no" "FORBIDDEN_ACTIONS_USED: no" "$msg"
assert_contains "3a instructs newline-separated fields" "newline-separated" "$msg"
assert_not_contains "3a does not request semicolon-separated final report" "semicolon-separated" "$msg"
assert_not_contains "3a final field has no trailing period in copied value" "FORBIDDEN_ACTIONS_USED: no." "$msg"
assert_contains "3a contains slug 'alpha'" "alpha" "$msg"
unset msg

echo
echo "=== Test 4: wait_for_all_workers_ready opt-out ==="

# 4a: CLAUDE_OVERLAY_LOAD_VERIFY=0 → skip 即 return 0 (sleep / capture-pane を呼ばない)
export CLAUDE_OVERLAY_LOAD_VERIFY=0
start=$SECONDS
wait_for_all_workers_ready "test-session" "alpha" "beta" 2>&1 || rc=$?
rc="${rc:-0}"
elapsed=$((SECONDS - start))
assert_rc "4a opt-out → rc=0" "0" "$rc"
# opt-out 経路は sleep を一切しないことを確認 (1s 未満)
if [[ $elapsed -lt 2 ]]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS: 4a opt-out completes in <2s (elapsed=${elapsed}s)"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAIL_DETAILS+=("4a opt-out should be near-instant but took ${elapsed}s")
  echo "  FAIL: 4a opt-out took too long (elapsed=${elapsed}s)"
fi
unset CLAUDE_OVERLAY_LOAD_VERIFY rc

# 4b: every slug must receive at least one probe even when earlier probes use
# the configured timeout budget. This avoids false BLOCKED escalation for
# healthy later workers in 3+ worker launches.
out=$(
  {
    probe_skill_registry() {
      sleep 2
      return 0
    }
    escalate_blocked_to_slug() {
      printf 'escalated:%s\n' "$2"
    }
    CLAUDE_OVERLAY_LOAD_VERIFY=1 \
    CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS=0 \
    CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=2 \
    CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS=1 \
      wait_for_all_workers_ready "session" "a" "b" "c"
  } 2>&1
) && rc=0 || rc=$?
assert_rc "4b slow successful probes do not skip later workers → rc=0" "0" "$rc"
assert_contains "4b final worker was probed" "probing skill registry for 'c'" "$out"
assert_not_contains "4b no worker skipped before probe" "SKIPPED" "$out"
assert_not_contains "4b no false BLOCKED escalation" "escalated:" "$out"
unset out rc

# 4c: timeout=0 is an operator mistake; normalize it instead of letting
# MAX_WAIT skip every worker before one registry probe.
out=$(
  {
    probe_skill_registry() {
      printf 'probed:%s\n' "$2"
      return 0
    }
    escalate_blocked_to_slug() {
      printf 'escalated:%s\n' "$2"
    }
    CLAUDE_OVERLAY_LOAD_VERIFY=1 \
    CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS=0 \
    CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=0 \
    CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS=0 \
      wait_for_all_workers_ready "session" "a" "b" "c"
  } 2>&1
) && rc=0 || rc=$?
assert_rc "4c zero timeout is normalized → rc=0" "0" "$rc"
assert_contains "4c first worker was probed" "probing skill registry for 'a'" "$out"
assert_contains "4c final worker was probed" "probing skill registry for 'c'" "$out"
assert_not_contains "4c no worker skipped before probe" "SKIPPED" "$out"
assert_not_contains "4c no false BLOCKED escalation" "escalated:" "$out"
unset out rc

# 4d: failed early probes spend escalation time too. The launcher must still
# probe later workers instead of letting escalation delay consume the pre-probe
# MAX_WAIT guarantee.
out=$(
  {
    probe_skill_registry() {
      if [[ "$2" == "a" || "$2" == "b" ]]; then
        sleep 2
        printf 'missing-skill\n'
        return 1
      fi
      if [[ "$2" == "c" ]]; then
        return 0
      fi
    }
    escalate_blocked_to_slug() {
      sleep 1
      printf 'escalated:%s\n' "$2"
    }
    CLAUDE_OVERLAY_LOAD_VERIFY=1 \
    CLAUDE_OVERLAY_LOAD_MIN_WAIT_SECONDS=0 \
    CLAUDE_OVERLAY_LOAD_MAX_WAIT_SECONDS=2 \
    CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS=1 \
      wait_for_all_workers_ready "session" "a" "b" "c"
  } 2>&1
) && rc=0 || rc=$?
assert_rc "4d failed early probes still return failure → rc=1" "1" "$rc"
assert_contains "4d final worker was still probed" "probing skill registry for 'c'" "$out"
assert_contains "4d final worker can succeed" "'c' OK" "$out"
assert_not_contains "4d final worker was not skipped" "'c' SKIPPED" "$out"
assert_not_contains "4d no false escalation for final worker" "escalated:c" "$out"
unset out rc

echo
echo "=== Test 5: cmd_verify validates session arg ==="

# 5a: 引数なし or 空 session → exit 2 (usage error)
rc=0
(cmd_verify "" 2>/dev/null) || rc=$?
assert_rc "5a empty session arg → rc=2" "2" "$rc"
unset rc

echo
echo "=== Test 6: resolve_enabled_plugins (Layer 3) ==="
# Layer 3 auto-install: parse .claude/settings.json `enabledPlugins` (object with bool
# values, only `true` entries are active) and emit one `key@marketplace` per line.

# 6a: valid settings.json with mixed true/false values
tmp_settings_6a=$(mktemp)
cat > "$tmp_settings_6a" <<'JSON'
{
  "enabledPlugins": {
    "codex@openai-codex": true,
    "harness@cc-triad-relay": true,
    "disabled-plugin@unknown": false,
    "document-skills@anthropic-agent-skills": true
  }
}
JSON
out=$(resolve_enabled_plugins "$tmp_settings_6a" 2>/dev/null | sort | tr '\n' ' ')
assert_eq "6a enabled plugins extracted (3 true values, sorted)" \
  "codex@openai-codex document-skills@anthropic-agent-skills harness@cc-triad-relay " \
  "$out"
rm -f "$tmp_settings_6a"
unset tmp_settings_6a out

# 6b: missing settings.json → rc=1
rc=0
out=$(resolve_enabled_plugins "/nonexistent/path/settings.json" 2>/dev/null) || rc=$?
assert_rc "6b missing settings.json → rc=1" "1" "$rc"
assert_eq "6b empty stdout on missing settings.json" "" "$out"
unset rc out

# 6c: settings.json without enabledPlugins key → empty stdout, rc=0
tmp_settings_6c=$(mktemp)
echo '{"theme": "dark"}' > "$tmp_settings_6c"
out=$(resolve_enabled_plugins "$tmp_settings_6c" 2>/dev/null)
assert_eq "6c missing enabledPlugins key → empty stdout" "" "$out"
rm -f "$tmp_settings_6c"
unset tmp_settings_6c out

echo
echo "=== Test 7: resolve_handoff_copy_sources (Layer 3) ==="
# HANDOFF_COPY_SOURCES env: colon-separated absolute paths. Each is realpath-
# normalized and emitted one per line on stdout.

# 7a: empty env → empty stdout, rc=0
unset HANDOFF_COPY_SOURCES
out=$(resolve_handoff_copy_sources 2>/dev/null)
assert_eq "7a empty env → empty stdout" "" "$out"
unset out

# 7b: colon-separated absolute paths → newline-separated stdout
tmp_dir_7b_1=$(mktemp -d)
tmp_dir_7b_2=$(mktemp -d)
export HANDOFF_COPY_SOURCES="${tmp_dir_7b_1}:${tmp_dir_7b_2}"
out=$(resolve_handoff_copy_sources 2>/dev/null | tr '\n' ' ')
assert_contains "7b first abs path resolved" "$tmp_dir_7b_1" "$out"
assert_contains "7b second abs path resolved" "$tmp_dir_7b_2" "$out"
rmdir "$tmp_dir_7b_1" "$tmp_dir_7b_2"
unset HANDOFF_COPY_SOURCES out tmp_dir_7b_1 tmp_dir_7b_2

# 7c: relative path → rc=1 (must be absolute, path-traversal mitigation)
export HANDOFF_COPY_SOURCES="relative/path"
rc=0
out=$(resolve_handoff_copy_sources 2>/dev/null) || rc=$?
assert_rc "7c relative path → rc=1" "1" "$rc"
unset HANDOFF_COPY_SOURCES rc out

echo
echo "=== Test 8: install_plugins_for_worktree (Layer 3, dry-run) ==="
# install_plugins_for_worktree <wt_path> [<settings_json_path>]: enumerates enabled
# plugins and emits `claude plugin install <name@marketplace> --scope=project` per plugin.

# 8a: missing settings.json → skip with rc=0 (generic launcher; not all consumers ship
#     a settings.json; skip is non-fatal)
tmp_wt_8a=$(mktemp -d)
DRY_RUN=1
rc=0
install_plugins_for_worktree "$tmp_wt_8a" 2>/dev/null || rc=$?
assert_rc "8a missing settings.json skipped (rc=0)" "0" "$rc"
DRY_RUN=0
rmdir "$tmp_wt_8a"
unset rc tmp_wt_8a

# 8b: valid settings.json → emits one install command per enabled plugin (dry-run)
tmp_wt_8b=$(mktemp -d)
mkdir -p "${tmp_wt_8b}/.claude"
cat > "${tmp_wt_8b}/.claude/settings.json" <<'JSON'
{
  "enabledPlugins": {
    "codex@openai-codex": true,
    "harness@cc-triad-relay": true
  }
}
JSON
DRY_RUN=1
out=$(install_plugins_for_worktree "$tmp_wt_8b" 2>&1)
assert_contains "8b emits codex install" "claude plugin install 'codex@openai-codex' --scope=project" "$out"
assert_contains "8b emits harness install" "claude plugin install 'harness@cc-triad-relay' --scope=project" "$out"
DRY_RUN=0
rm -rf "$tmp_wt_8b"
unset out tmp_wt_8b

echo
echo "=== Test 9: copy_handoff_sources_to_worktree (Layer 3, dry-run) ==="
# copy_handoff_sources_to_worktree <wt_path>: reads HANDOFF_COPY_SOURCES, validates,
# and emits `cp -RP <src> <wt_path>/` per source (preserves nested symlinks).

# 9a: empty env → no emit (no-op)
tmp_wt_9a=$(mktemp -d)
unset HANDOFF_COPY_SOURCES
DRY_RUN=1
out=$(copy_handoff_sources_to_worktree "$tmp_wt_9a" 2>&1)
assert_eq "9a empty env → no emit" "" "$out"
DRY_RUN=0
rmdir "$tmp_wt_9a"
unset out tmp_wt_9a

# 9b: 1 abs path → emits cp -RP. macOS resolves `/var` → `/private/var` via the
# `cd ... && pwd -P` realpath step inside resolve_handoff_copy_sources, so the
# expected needle must use the same normalization (otherwise the test is
# environment-sensitive and fails on macOS but passes on Linux).
tmp_src_9b=$(mktemp -d)
tmp_wt_9b=$(mktemp -d)
tmp_src_9b_resolved=$(cd "$tmp_src_9b" && pwd -P)
export HANDOFF_COPY_SOURCES="$tmp_src_9b"
DRY_RUN=1
out=$(copy_handoff_sources_to_worktree "$tmp_wt_9b" 2>&1)
assert_contains "9b dry-run emits cp -RP" \
  "cp -RP '$tmp_src_9b_resolved' '${tmp_wt_9b}/'" "$out"
DRY_RUN=0
rmdir "$tmp_src_9b" "$tmp_wt_9b"
unset HANDOFF_COPY_SOURCES out tmp_src_9b tmp_src_9b_resolved tmp_wt_9b

echo
echo "=== Test 10: cmd_cleanup (Layer 3, dry-run with explicit slugs) ==="
# cmd_cleanup <session> [<slug1> ...]: when explicit slugs are passed (test path or
# operator override), emits per-slug worktree remove + final tmux kill-session.

# 10a: dry-run with explicit slugs → emits git worktree remove + tmux kill-session
DRY_RUN=1
export TMUX_SESSION_NAME="test-cleanup-session"
export WORKTREE_PARENT_DIR="/tmp"
export WORKTREE_PREFIX="test-cleanup-wt-"
out=$(cmd_cleanup "test-cleanup-session" "alpha" "beta" 2>&1)
assert_contains "10a emits worktree remove --force for alpha" \
  "git worktree remove '/tmp/test-cleanup-wt-alpha' --force" "$out"
assert_contains "10a emits worktree remove --force for beta" \
  "git worktree remove '/tmp/test-cleanup-wt-beta' --force" "$out"
assert_contains "10a emits tmux kill-session" \
  "tmux kill-session -t 'test-cleanup-session'" "$out"
DRY_RUN=0
unset TMUX_SESSION_NAME WORKTREE_PARENT_DIR WORKTREE_PREFIX out

echo
echo "=== Test 11: probe_skill_registry tmux capture failure ==="

# 11a: capture-pane failure must be surfaced as rc=2, not as missing skills.
out=$(
  tmux() {
    if [[ "$1" == "send-keys" || "$1" == "clear-history" ]]; then
      return 0
    fi
    if [[ "$1" == "capture-pane" ]]; then
      return 99
    fi
    return 0
  }
  probe_skill_registry "session" "alpha" "harness:tdd-implement" 1
) && rc=0 || rc=$?
assert_rc "11a capture-pane failure → rc=2" "2" "$rc"
assert_contains "11a capture failure message" "tmux capture-pane failed" "$out"
unset out rc

# 11b: stale visible pane content from before /help must not satisfy the probe.
out=$(
  capture_count=0
  tmux() {
    if [[ "$1" == "send-keys" || "$1" == "clear-history" ]]; then
      return 0
    fi
    if [[ "$1" == "capture-pane" ]]; then
      capture_count=$((capture_count + 1))
      if [[ "$capture_count" -eq 1 ]]; then
        printf 'stale prior pane says harness:tdd-implement\n'
      else
        printf 'stale prior pane says harness:tdd-implement\n'
        printf 'fresh help output without loaded skill\n'
      fi
      return 0
    fi
    return 0
  }
  probe_skill_registry "session" "alpha" "harness:tdd-implement" 1
) && rc=0 || rc=$?
assert_rc "11b stale visible pane is excluded before scan → rc=1" "1" "$rc"
assert_contains "11b reports missing skill from fresh output" "harness:tdd-implement" "$out"
unset out rc

# 11c: direct probe / cmd_verify path also normalizes timeout=0 to the poll
# interval, otherwise the loop does not capture any fresh /help output.
out=$(
  count_file="$(mktemp)"
  printf '0' > "$count_file"
  sleep() { :; }
  tmux() {
    if [[ "$1" == "send-keys" || "$1" == "clear-history" ]]; then
      return 0
    fi
    if [[ "$1" == "capture-pane" ]]; then
      local capture_count
      capture_count="$(cat "$count_file")"
      capture_count=$((capture_count + 1))
      printf '%s' "$capture_count" > "$count_file"
      if [[ "$capture_count" -gt 1 ]]; then
        printf 'harness:tdd-implement harness:codex-sync harness:pseudo-coderabbit-loop harness:coderabbit-review harness:codex-team harness:session-handoff\n'
      fi
      return 0
    fi
    return 0
  }
  probe_rc=0
  CLAUDE_SKILL_VERIFY_TIMEOUT_SECONDS=0 probe_skill_registry "session" "alpha" || probe_rc=$?
  printf 'probe_rc=%s\n' "$probe_rc"
  printf 'capture_count=%s\n' "$(cat "$count_file")"
  rm -f "$count_file"
  exit "$probe_rc"
) && rc=0 || rc=$?
assert_rc "11c direct probe zero timeout is normalized → rc=0" "0" "$rc"
assert_contains "11c direct probe returned zero" "probe_rc=0" "$out"
assert_contains "11c direct probe captured fresh output" "capture_count=2" "$out"
unset out rc

echo
echo "============================================================"
echo "Results: PASS=$PASS_COUNT  FAIL=$FAIL_COUNT"
echo "============================================================"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo
  echo "Failure details:"
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  - $detail"
  done
  exit 1
fi

exit 0
