# Claude Code Harness

A portable, TypeScript-powered guardrail and agent harness for [Claude Code](https://claude.com/claude-code).

## What this gives you

- **13 guardrail rules** (R01–R13) that block dangerous operations: `sudo`, `rm -rf`, force-push, `curl | bash`, `.env` leakage, and more. Configurable via `harness.config.json`.
- **5 native agents** (no Codex required): `worker` (implement + self-review + verify + commit), `reviewer` (read-only multi-angle review), `scaffolder` (docs + state sync), `security-auditor`, `context-audit-agent`. **2 optional** Codex-backed agents — `codex-sync` (synchronous second-opinion review) and `coderabbit-mimic` (local pseudo-CodeRabbit loop) — fail fast if Codex is not installed.
- **19 slash commands**: 5 verb (`/harness-plan`, `/harness-work`, `/harness-review`, `/harness-release`, `/harness-setup`) plus 14 workflow primitives (`/clarify`, `/tdd-implement`, `/parallel-worktree`, `/parallel-worktree-v2`, `/coderabbit-review`, `/pseudo-coderabbit-loop`, `/session-handoff`, `/harness-merge-train`, `/codex-team`, `/context-audit`, `/branch-merge`, `/new-feature-branch`, `/claude-oneshot`, `/harness-self-improve`).
- **Zero native dependencies** (pure JS JSON state store) — works on macOS, Linux, and Windows without `npm install` native rebuilds.

## Installation

```bash
claude plugin marketplace add <owner>/cc-triad-relay
claude plugin install harness@cc-triad-relay --scope project
```

Or use the bundled helper script from any git checkout of this repo:

```bash
# Harness only (default — recommended baseline):
bash /path/to/cc-triad-relay/scripts/install-project.sh

# Harness + Codex companion (opt-in, enables codex-sync / coderabbit-mimic):
bash /path/to/cc-triad-relay/scripts/install-project.sh --with-codex
```

Or for local development:

```bash
claude --plugin-dir /path/to/cc-triad-relay/plugins/harness
```

Then in your project root:

```bash
# Inside Claude Code session
/harness-setup init
```

This creates a `harness.config.json` tailored to your project.

### Optional companion: `openai-codex`

The Harness ships stack- and LLM-neutral. Two of its agents —
`codex-sync` and `coderabbit-mimic` — shell out to the OpenAI
[Codex](https://github.com/openai/codex-plugin-cc) companion plugin to
run synchronous code review / pseudo-CodeRabbit flows. Without Codex
installed, invoking either of those two agents **errors immediately
with a clear, grep-able message** (they don't degrade gracefully —
they refuse to proceed). Every other agent, command, guardrail, and
hook works identically with or without Codex. **Installing Codex is
therefore optional**:

| Plugin installed | What works | What errors on invocation |
|------------------|------------|---------------------------|
| `harness` only (default) | All 13 guardrails, 19 commands (5 verb + 14 workflow), 5 native agents (`worker` / `reviewer` / `scaffolder` / `security-auditor` / `context-audit-agent`), all 12 lifecycle hooks | `codex-sync` fails fast with `ERROR: Codex plugin not found` and `coderabbit-mimic` fails with `ERROR: codex-companion.mjs not found.` — both hard errors that stop the agent before any work starts. Other agents and commands are unaffected. |
| `harness` + `codex` | Everything above **plus** Codex-powered synchronous second-opinion review (`codex-sync`) and local pseudo-CodeRabbit loop (`coderabbit-mimic`) | — |

`install-project.sh --with-codex` flips the opt-in; otherwise run
`claude plugin install codex@openai-codex --scope project` manually.
Verify with `harness doctor`, which reports:

```
codex plugin:        detected at ~/.claude/plugins/cache/openai-codex/codex
```

or

```
codex plugin:        not installed (optional — ...)
```

Re-install is a no-op if already present (idempotent).

### Verifying the install — `harness doctor`

```bash
harness doctor
```

Surfaces:

- Core build presence + mtime.
- Codex companion presence.
- `harness.config.json` location + parse status.
- Resolved project security checklist (from `security.projectChecklistPath`).
- Resolved plans file + handoff files.
- Project-local skill directory (`.claude/skills/`).
- User-level overlays (`~/.claude/{skills,commands,agents}/`) — useful
  when diagnosing which layer a skill / command came from.

## Quickstart — 4-step day-1 flow

After `harness doctor` reports green, the canonical day-1 workflow is four
slash commands. Run each from inside a Claude Code session in your project
root:

```text
   ┌──────────────────────┐    ┌─────────────────────────┐    ┌───────────────────────┐    ┌──────────────────────────┐
   │ 1. /harness:clarify  │ →  │ 2. /harness:harness-plan│ →  │ 3. /harness:harness-  │ →  │ 4. /harness:coderabbit-  │
   │    "<topic>"         │    │    create               │    │    work <task-id>     │    │    review <PR>           │
   └──────────────────────┘    └─────────────────────────┘    └───────────────────────┘    └──────────────────────────┘
       depth-first               reviewer-driven split             full TDD quality-gate      Background watch +
       decision interview,       into priority-ordered             chain with Codex           auto-respond loop
       1 question per turn       Plans.md tasks                    parallel / Pseudo CR /     until Real CodeRabbit
       (no code yet)                                               Real CR / final review     Strong Clear + polish
```

Step 1 produces a *shared understanding* of the work. Step 2 turns it into a
backlog. Step 3 implements one task end-to-end through the full quality-gate
chain (TDD → Codex parallel → refactor → Pseudo CodeRabbit → push → Real
CodeRabbit → Codex final review). Step 4 watches CodeRabbit on the resulting
PR and applies fixes until the review clears. After Step 4, run
`/codex-team` for adversarial second-opinion and then squash merge (manually
or via `/harness-merge-train` for multi-PR batches).

## Core skills — front-line entry points

The 19 commands fall into two layers. Most day-to-day work goes through six
front-line entry points:

| skill | trigger phrases | role |
|---|---|---|
| `/harness:clarify "<topic>"` | "clarify", "design review", new feature / refactor / migration / new PRD | Pre-implementation interview that walks the decision tree depth-first, one question per turn |
| `/harness:harness-plan create` | "create a plan", "split into tasks" | Reviewer-driven Plans.md construction (interactive hearing → reviewer pass → save) |
| `/harness:harness-work [task]` | "implement", "fix bug", "add feature", `/work`, `/breezing` | Plans-driven dispatcher; Auto Mode Detection picks Solo (1 task) / Parallel (2-3) / Breezing (4+) and delegates to `/tdd-implement` v2 or `/parallel-worktree` |
| `/harness:parallel-worktree-v2` | 3+ independent sub-tasks, long-running TDD, need per-worktree skill access | **Model B** orchestrator — one independent top-level `claude` per worktree (in tmux), each runs the full TDD quality-gate chain end-to-end |
| `/harness:session-handoff check` | session start / session end, "handoff", "rehydration" | Read-only 3-gate check (structural integrity + content comprehension + rehydration synthesis) |
| `/harness:coderabbit-review <PR>` | after pushing a PR, "handle CodeRabbit review" | Background watch for CodeRabbit reviews + auto-respond loop until Strong Clear |

The remaining 13 commands are workflow primitives that the entry points
dispatch into: `/tdd-implement`, `/parallel-worktree` (Model A legacy),
`/pseudo-coderabbit-loop`, `/codex-team`, `/harness-merge-train`,
`/branch-merge`, `/new-feature-branch`, `/context-audit`, `/claude-oneshot`,
`/harness-self-improve`, plus the three other verb skills (`/harness-review`,
`/harness-release`, `/harness-setup`).

## Parallel execution: Model A vs Model B

`/harness:parallel-worktree` (Model A, legacy) and
`/harness:parallel-worktree-v2` (Model B) coexist. Pick one per batch:

| | Model A (`/parallel-worktree`) | Model B (`/parallel-worktree-v2`) |
|---|---|---|
| per-worktree | `Agent`-tool subagent (`harness:worker`) | independent top-level `claude` process in a tmux window |
| skill access | restricted (subagents cannot use `Skill`) | full skills / agents / MCP / hooks |
| context budget | shared with coordinator | each worktree has its own |
| late-stage quality gates (Pseudo CR / Real CR / adversarial review) | coordinator-serialized after workers finish | each worktree runs them itself |
| good for | 2-3 short sub-task batches, stable subagent flows | 3+ long-running tasks, true per-worktree quality gates |

When the workload is small (2-3 sub-tasks, short runtime), Model A is the
default. When sub-tasks are independent enough to deserve their own context
budget and the full quality-gate chain per worktree, switch to Model B.

## Task tracker modes — Plans vs handoff

`/harness:harness-work` and the lifecycle hooks read tasks from one of two
sources, selected by `harness.config.json`. Pick one of the two snippets
below (they are valid as-is — no comma fix-ups needed when copying):

**Plans-mode** (default — flat single-file flow):

```json
{
  "work": {
    "taskTrackerMode": "plans",
    "plansFile": "Plans.md"
  }
}
```

**Handoff-mode** (recommended for new projects — 4-layer structure):

```json
{
  "work": {
    "taskTrackerMode": "handoff",
    "handoffPaths": {
      "roadmap":   ".docs/handoff/<project>-roadmap.md",
      "backlog":   ".docs/handoff/<project>-backlog.md",
      "current":   ".docs/handoff/<project>-current.md",
      "decisions": ".docs/handoff/<project>-decisions.md"
    }
  }
}
```

- **Plans-mode** (`"plans"`, in-memory default for backward compat): legacy
  single-file flow. One `Plans.md` holds active tasks, completed history,
  and the assignment table.
- **Handoff-mode** (`"handoff"`, **template default** — new projects):
  four files split the responsibilities — `roadmap.md` (Phase / Week / AC
  source-of-truth) + `backlog.md` (priority-ordered dispatchable view) +
  `current.md` (bird's-eye index) + `decisions.md` (append-only). All four
  paths are required when `taskTrackerMode === "handoff"`; missing or
  malformed entries cause a silent fallback to Plans-mode with a stderr
  warning. Use `/harness:session-handoff init` to scaffold.

> **Template default vs in-memory default**: New projects bootstrapped via
> `harness init` get handoff-mode automatically (`template/.claude/harness.config.json.tmpl`
> ships with `taskTrackerMode = "handoff"` + a populated `handoffPaths`,
> and `template/.docs/handoff/<project>-{current,backlog,roadmap,decisions}.md.tmpl`
> + `template/History.md.tmpl` provide the 4-layer skeleton). The
> `DEFAULT_CONFIG` in-memory default in `plugins/harness/core/src/config.ts`
> stays `"plans"` to avoid silent regression: switching it to `"handoff"`
> would make consumers that omit `handoffPaths` fall back to Plans-mode
> through a stderr WARN that CI logs typically swallow. Existing
> Plans-mode users see no behaviour change; new projects start with the
> recommended 4-layer handoff structure via the template.

Both modes coexist indefinitely — Plans-mode remains a first-class option
for long-lived legacy projects, Handoff-mode is the recommended starting
point for new projects.

## Quick configuration

`harness.config.json`:

```json
{
  "projectName": "my-app",
  "language": "en",
  "protectedDirectories": ["training-data", "fixtures"],
  "protectedEnvVarNames": ["OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY"],
  "workMode": { "bypassRmRf": false, "bypassGitPush": false },
  "tampering": { "severity": "approve" }
}
```

## Documentation

- [Installation](./docs/en/installation.md)
- [Architecture](./docs/en/architecture.md)
- [Configuration](./docs/en/configuration.md)
- [Guardrails (R01–R13)](./docs/en/guardrails.md)
- [Agents](./docs/en/agents.md)
- [Commands](./docs/en/commands.md)
- [Development](./docs/en/development.md)
- [Migration](./docs/en/migration-from-v2.md)
- [Security](./docs/en/security.md)
- [Troubleshooting](./docs/en/troubleshooting.md)

Japanese: [日本語ドキュメント](./docs/ja/)

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

---

## Known notes

1. **If you fork this repository**, run
   `scripts/set-owner.sh <your-github-user>` to rewrite the owner in
   docs, schema, and `plugin.json` before publishing to your own
   marketplace. Review the diff with `git diff` before committing.
2. **Parallel build process**: the v0.1.0 implementation used a mixed
   strategy — Claude Code as the primary author plus three parallel
   Codex agents. Two of the three Codex jobs failed with a Bash
   permission issue on the host; the third (the `codex-sync` agent
   generalization) finished. Claude Code picked up the failed jobs and
   completed them directly. Keep this in mind when reproducing the
   build on a host where `codex-companion.mjs` cannot be spawned: fall
   back to direct in-session edits.
3. **State store concurrency**: the pure-JS JSON store in
   `plugins/harness/core/src/state/` is safe for single-process use.
   If you run `/breezing`-style parallel sessions against the same
   project, state writes can race. File locking (e.g.
   `proper-lockfile`) is a candidate for future releases; until then,
   avoid simultaneous multi-session writes on the same project.
4. **`permission.ts` double-encoding**: the reviewer flagged a
   CRITICAL-tier design concern in
   `plugins/harness/core/src/guardrails/permission.ts` — the
   `PermissionResponse` is packaged via `systemMessage` and then
   unpacked again in `index.ts`. Current behaviour is correct and
   tested, but the layering is fragile. Avoid adding new behaviour to
   that path until a refactor is completed in a future release.
5. **Author metadata note**: commits authored prior to the v0.3.0
   release reference the maintainer's personal email in the `author`
   field. From v0.3.0 onward the repository uses the GitHub noreply
   alias (`<userid>+<handle>@users.noreply.github.com`) so no further
   personal email is introduced. History rewriting was deliberately
   avoided to preserve commit SHA stability across already-published
   releases and CHANGELOG references.

Maintainer notes and implementation logs are kept under
`docs/maintainer/` (excluded from marketplace distribution). See
`CHANGELOG.md` for user-facing change history and `CONTRIBUTING.md` for
the plugin generality policy.
