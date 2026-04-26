# Handoff Stop hook — generic sample

> Companion to `commands/session-handoff.md`. Drop this script into a
> consumer project's `.claude/hooks/` directory to detect a stale
> `current.md` after every Claude turn and remind the agent to run
> `Skill({skill: "harness:session-handoff", args: "update"})` plus the
> standard 8-section final report template.

## What it does

Each time Claude returns control to the user (`Stop` hook), the script:

1. Locates the project's handoff directory (`.docs/handoff/`).
2. Locates the latest **session archive** (`session-*.md`, excludes
   `summary-*.md` / `pre-*.md`).
3. Compares its mtime with `*-current.md`. If the archive is **newer**
   than `current.md`, emits a stderr reminder telling Claude to invoke
   `harness:session-handoff` via the `Skill` tool — never via manual
   `Edit` / `Write`.
4. Throttles itself: the same cwd will not warn twice within 60 seconds
   (silences noise during multi-turn sessions).

The reminder reaches Claude's next turn as a system-reminder message
(stderr from `Stop` hooks is surfaced to the model).

## Sample script (consumer-side, drop into `.claude/hooks/`)

Save the following as `<project-root>/.claude/hooks/handoff-stop-reminder.sh`,
then `chmod +x` it. The plugin distributes this only as a sample because
hook installation is project-scoped; the harness plugin does not auto-write
into a consumer's `.claude/hooks/`.

```bash
#!/usr/bin/env bash
# Stop hook: handoff freshness check + final report format reminder
#
# 目的: claude が turn 終了するたびに、handoff の current.md が最新 archive
# より古くなっていないかチェックし、stale なら skill tool 経由で update / 最終
# 報告 標準フォーマット emit を促す reminder を stderr に出力する (claude 次
# turn の context に system reminder として届く)。
#
# 設計:
# - throttle: 同 cwd で 60 秒以内に warn 済なら silent (noise 抑制)
# - 検出条件: 最新 archive (`session-*.md`) の mtime > current.md mtime
# - silent fail: handoff dir 不在 / current.md 不在は silent (false-positive 回避)

set -eu

HANDOFF_DIR="${PWD}/.docs/handoff"
[ ! -d "$HANDOFF_DIR" ] && exit 0

# Find current.md (any *-current.md file)
CURRENT_MD=""
for f in "$HANDOFF_DIR"/*-current.md; do
  [ -f "$f" ] && { CURRENT_MD="$f"; break; }
done
[ -z "$CURRENT_MD" ] && exit 0

# Find latest session archive (session-* のみ、summary-* / pre-* 除外)
LATEST_ARCHIVE=""
if [ -d "$HANDOFF_DIR/archive" ]; then
  LATEST_ARCHIVE=$(find "$HANDOFF_DIR/archive" -maxdepth 1 -name "session-*.md" -print 2>/dev/null \
    | xargs -I{} stat -f "%m %N" "{}" 2>/dev/null \
    | sort -nr | head -1 | cut -d' ' -f2-)
fi

# Throttle marker (60s) — 同 cwd hash でユニーク
CWD_HASH=$(echo "$PWD" | shasum -a 256 2>/dev/null | cut -c1-12)
MARKER="/tmp/.claude-handoff-warned-${CWD_HASH}"
if [ -f "$MARKER" ]; then
  MARKER_AGE=$(( $(date +%s) - $(stat -f %m "$MARKER" 2>/dev/null || echo 0) ))
  [ "$MARKER_AGE" -lt 60 ] && exit 0
fi

# Compare mtimes
if [ -n "$LATEST_ARCHIVE" ] && [ -f "$LATEST_ARCHIVE" ]; then
  CURRENT_MTIME=$(stat -f %m "$CURRENT_MD" 2>/dev/null || echo 0)
  ARCHIVE_MTIME=$(stat -f %m "$LATEST_ARCHIVE" 2>/dev/null || echo 0)
  if [ "$ARCHIVE_MTIME" -gt "$CURRENT_MTIME" ]; then
    cat >&2 <<MSG
[handoff-stop-reminder] STALE: 最新 archive '$(basename "$LATEST_ARCHIVE")' が current.md より新しい。
  → Skill tool で 'harness:session-handoff' を 'update' 引数で起動して current.md を最新化、
    最終報告は memory 'reference_session_final_report_template.md' のフォーマットで emit してください。
MSG
    touch "$MARKER"
  fi
fi

exit 0
```

## Install (consumer-side, 3 step)

1. **Copy the script** to the consumer project root:

   ```bash
   mkdir -p .claude/hooks
   $EDITOR .claude/hooks/handoff-stop-reminder.sh   # paste the script above
   chmod +x .claude/hooks/handoff-stop-reminder.sh
   ```

2. **Wire it as a Stop hook** in `.claude/settings.json` (or
   `.claude/settings.local.json` if you don't want to commit it):

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/handoff-stop-reminder.sh"
             }
           ]
         }
       ]
     }
   }
   ```

3. **Confirm wiring**: run any short Claude turn and watch stderr. The
   first turn after an archive write will surface the reminder; the
   throttle marker silences subsequent turns within 60 s.

## Why a Stop hook (not SessionEnd)

`SessionEnd` only fires when the user explicitly ends the session.
Long-running sessions can accumulate many archive writes between explicit
ends, so a freshness drift on `current.md` would never surface. `Stop`
fires every turn, which gives the agent a chance to self-correct mid-session
(or at least flag the drift to the next-turn context).

## Compatibility

The sample script uses BSD `stat -f` (macOS). For Linux consumers, swap
`stat -f` for `stat -c`:

```bash
# Linux (GNU coreutils)
stat -c %Y "$CURRENT_MD"   # mtime (seconds)
```

The throttle / archive-search logic is otherwise portable across both.

## Related

- `commands/session-handoff.md` (the skill the hook reminds you to use)
- `commands/references/final-report-format.md` (the 8-section template
  emitted after `archive`)
- `commands/references/post-check-verification.md` (Test 1-5 manual
  bridge between `check` PASS and "next session ready")
- consumer-side memory `reference_session_final_report_template.md`
  (project-specific extension to the 8-section template; the hook
  reminds Claude to recall this name)

---

**version**: v1.0 — 2026-04-27 generic Layer 3 sample (Layer 1 + Layer 2 are
consumer-side memory files; Layer 3 lives in this plugin)
