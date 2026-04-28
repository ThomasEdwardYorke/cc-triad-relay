#!/usr/bin/env bash
# plugins/harness/scripts/context-audit.sh
#
# Generic 3-gate context budget audit wrapper.
#
# Resolution order for configuration (first match wins):
#   1. `--config=<path>` argument (alternative harness.config.json)
#   2. `<repo-root>/harness.config.json` if present
#   3. Built-in fallback: exits 0 with a `[context-audit] no config` SKIP
#      message so consumers without `harness.config.json` do not fail CI noisily
#
# Exit codes (bit-OR, matching the consumer-precedent script):
#   0  PASS
#   1  size FAIL (over `budgetBytes`)
#   2  dead-link FAIL
#   4  entry-point FAIL
#   3 / 5 / 6 / 7  composite of the above

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: context-audit.sh [--config=<path>] [--quiet] [--strict]

  --config=<path>  Use an alternative harness.config.json
  --quiet          Suppress per-gate detail output (verdict line only)
  --strict         Treat WARN signals as FAIL (CI gate mode)
EOF
}

CONFIG_PATH=""
QUIET=0
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#--config=}" ;;
    --quiet) QUIET=1 ;;
    --strict) STRICT=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[context-audit] unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

# Resolve the harness config and treat ITS parent directory as the project
# root. Earlier the script used `pwd` directly, which silently audited the
# wrong subtree when run from a sub-directory of a repo (the `harness.config.json`
# at the repo root would be missed). Walking up from `pwd` to the first
# directory that contains `harness.config.json` keeps the contract
# predictable: invoke from anywhere in the tree, audit the same project.
if [ -z "$CONFIG_PATH" ]; then
  search_dir="$(pwd)"
  while [ "$search_dir" != "/" ] && [ -n "$search_dir" ]; do
    if [ -f "$search_dir/harness.config.json" ]; then
      CONFIG_PATH="$search_dir/harness.config.json"
      break
    fi
    parent="$(dirname "$search_dir")"
    if [ "$parent" = "$search_dir" ]; then
      break
    fi
    search_dir="$parent"
  done
fi

if [ -z "$CONFIG_PATH" ] || [ ! -f "$CONFIG_PATH" ]; then
  echo "[context-audit] no harness.config.json — SKIP (verdict=skip exitCode=0)"
  exit 0
fi

# `runContextAudit` treats `projectRoot` as the absolute path that auto-load
# / on-demand directories are resolved against. Anchor on the config file's
# directory so a `--config=path/to/elsewhere/harness.config.json` invocation
# audits THAT project, not the cwd.
PROJECT_ROOT="$(cd "$(dirname "$CONFIG_PATH")" && pwd)"

# Locate the compiled context-audit engine. The shipped layout puts this
# script at `plugins/harness/scripts/context-audit.sh` and the engine at
# `plugins/harness/core/dist/context-audit/index.js` — siblings under
# `plugins/harness/`. The dispatcher entry (`core/dist/index.js`) is a
# separate hook entry point and does NOT re-export `runContextAudit`, so we
# import directly from the engine module.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIST="$SCRIPT_DIR/../core/dist/context-audit/index.js"

if [ ! -f "$CORE_DIST" ]; then
  echo "[context-audit] core not built at $CORE_DIST" >&2
  echo "[context-audit] run: (cd plugins/harness/core && npm install && npm run build)" >&2
  exit 8
fi

# Delegate to a one-liner Node program that imports the core engine and runs
# `runContextAudit({ projectRoot: cwd, config: parsed.contextBudget })`.
# stdout receives the verdict + per-gate detail; exit code mirrors `result.exitCode`.
NODE_SCRIPT=$(cat <<'NODE_EOF'
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const configPath = process.argv[2];
const quiet = process.argv[3] === "1";
const strict = process.argv[4] === "1";
const corePath = process.argv[5];
const projectRoot = process.argv[6];

const raw = readFileSync(configPath, "utf-8");
let parsed;
try { parsed = JSON.parse(raw); } catch (e) {
  console.error(`[context-audit] failed to parse ${configPath}: ${e.message}`);
  process.exit(8);
}
const cfg = parsed?.contextBudget;
// Match the hook-side opt-in semantic: only fire when the consumer has
// **explicitly** set `enabled: true`. An empty `contextBudget: {}` block is
// treated as disabled, so accidental shape additions never silently start
// emitting audits.
if (cfg?.enabled !== true) {
  console.log("[context-audit] contextBudget disabled or absent — SKIP (exitCode=0)");
  process.exit(0);
}
const merged = {
  enabled: true,
  budgetBytes: typeof cfg.budgetBytes === "number" ? cfg.budgetBytes : 35000,
  autoLoadDirs: Array.isArray(cfg.autoLoadDirs) ? cfg.autoLoadDirs : [".claude/rules"],
  onDemandDirs: Array.isArray(cfg.onDemandDirs) ? cfg.onDemandDirs : ["docs/ai-rules"],
  entryPointFiles: Array.isArray(cfg.entryPointFiles) ? cfg.entryPointFiles : ["CLAUDE.md", "README.md"],
  indexFile: typeof cfg.indexFile === "string" ? cfg.indexFile : "",
};
const mod = await import(pathToFileURL(resolve(corePath)).href);
const result = await mod.runContextAudit({ projectRoot, config: merged });

if (!quiet) {
  console.log(`── Auto-loaded rules size ──`);
  console.log(`  total: ${result.totalBytes} bytes (budget: ${result.budgetBytes} bytes)`);
  for (const sig of result.signals) {
    const tag = sig.status === "pass" ? "PASS" : sig.status === "fail" ? "FAIL" : sig.status === "warn" ? "WARN" : "SKIP";
    console.log(`  [${sig.id}] ${tag}: ${sig.detail}`);
  }
  if (result.deadLinks.length > 0) {
    console.log(`  dead links:`);
    for (const dl of result.deadLinks) console.log(`    - ${dl}`);
  }
}
let exitCode = result.exitCode;
if (strict) {
  // Promote WARN signals to FAIL contributions so CI gates stay strict.
  for (const sig of result.signals) {
    if (sig.status !== "warn") continue;
    if (sig.id === "size") exitCode |= 1;
    else if (sig.id === "dead-link") exitCode |= 2;
    else if (sig.id === "entry-point") exitCode |= 4;
  }
}
console.log(exitCode === 0 ? "═══ ALL PASS ═══" : `═══ FAIL (exit ${exitCode}) ═══`);
process.exit(exitCode);
NODE_EOF
)

# Write the inline node program to a temp directory so the `.mjs` extension
# is preserved on every platform — `mktemp -t` on BSD/macOS appends the
# random component AFTER the template, which would clobber the `.mjs`
# suffix and trip ERR_UNKNOWN_FILE_EXTENSION at runtime.
TMP_DIR=$(mktemp -d -t harness-context-audit-XXXXXX)
TMP_NODE="$TMP_DIR/run.mjs"
trap 'rm -rf "$TMP_DIR"' EXIT
printf '%s\n' "$NODE_SCRIPT" >"$TMP_NODE"
node "$TMP_NODE" "$CONFIG_PATH" "$QUIET" "$STRICT" "$CORE_DIST" "$PROJECT_ROOT"
