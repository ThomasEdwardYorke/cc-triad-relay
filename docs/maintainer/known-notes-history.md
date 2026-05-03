# Known Notes — Maintainer / Internal History

This file preserves the maintainer-facing entries that previously lived in the
public README "Known notes" section. They were extracted because they describe
plugin-internal history (build process, layered design concerns, commit
metadata) that a downstream consumer reading the README does not need to act
on. The README retains only the user-facing entries (fork instructions, state
store concurrency).

---

## 1. Parallel build process — v0.1.0 implementation strategy

The `v0.1.0` implementation used a mixed strategy — Claude Code as the primary
author plus three parallel Codex agents. Two of the three Codex jobs failed
with a Bash permission issue on the host; the third (the `codex-sync` agent
generalization) finished. Claude Code picked up the failed jobs and completed
them directly. Keep this in mind when reproducing the build on a host where
`codex-companion.mjs` cannot be spawned: fall back to direct in-session edits.

## 2. `permission.ts` double-encoding (CRITICAL-tier design concern)

The reviewer flagged a CRITICAL-tier design concern in
`plugins/harness/core/src/guardrails/permission.ts` — the `PermissionResponse`
is packaged via `systemMessage` and then unpacked again in `index.ts`. Current
behaviour is correct and tested, but the layering is fragile. Avoid adding new
behaviour to that path until a refactor is completed in a future release.

## 3. Author metadata note (commit SHA stability rationale)

Commits authored prior to the `v0.3.0` release reference the maintainer's
personal email in the `author` field. From `v0.3.0` onward the repository uses
the GitHub noreply alias (`<userid>+<handle>@users.noreply.github.com`) so no
further personal email is introduced. History rewriting was deliberately
avoided to preserve commit SHA stability across already-published releases and
CHANGELOG references.

---

## Why these were moved out of the README

Per `CONTRIBUTING.md` §§1-5 generality policy, the public README should
describe behaviour and configuration that downstream consumers act on.
Maintainer narrative (build process forensics, internal-tier design concerns,
historical metadata decisions) is operationally inert from the consumer
perspective and clutters the surface that new users skim. Keeping it here
under `docs/maintainer/` makes the README leaner while preserving the history
for project archaeology.

The original README ordering was: 1 (fork) → 2 (build) → 3 (state store) →
4 (permission.ts) → 5 (author metadata). Entries 2, 4, 5 moved here; entries
1 and 3 stayed in the README and were renumbered as 1 and 2.
