# Contributing to Claude Code Harness

Thank you for contributing. These guidelines protect users who install this plugin in projects that have nothing to do with the development test bed. **Please read Sections 1–8 before opening a PR.**

---

## Section 1 — Separation Principle: Plugin Core vs Project-Local Customization

Claude Code Harness is a **reusable, shared, versioned plugin**. Anything that only makes sense inside one repository, one language stack, one locale, or one team workflow must stay out of shipped plugin core.

### 1.1 What may be included in plugin core

- Reusable commands, agents, hooks, schemas, tests, and docs that work without knowing a specific project name, branch strategy, language, framework, or human process.
- Generic example values (see Section 2).
- Optional integrations that are clearly optional, capability-checked, and have a documented fallback.
- Config keys that let downstream projects supply their own paths, commands, file names, and workflow choices via `harness.config.json`.

### 1.2 What must NOT be included in plugin core

- Real project names, branch names, repository paths, API names, file names, business terms, or handoff notes from a specific repository.
- Language- or framework-specific commands presented as the universal default for all users.
- Non-English user-facing strings in shipped `commands/`, `agents/`, `hooks/`, `plugin.json`, or `marketplace.json`, unless the file is explicitly localized documentation under `docs/<locale>/`.
- Internal tracker IDs, review-round IDs, "next-session" notes, or maintainer-only case-study notes.
- Hard dependencies on optional companion plugins or tools unless the feature is explicitly optional and capability-gated with a fallback.

### 1.3 Portability test

Before merging, verify:

> A contributor who has **never used the harness's development test-bed project**, does **not use Python**, and does **not read Japanese** can install the plugin and understand every shipped command, agent, hook, example, and default behavior without referring to any external document.

If the answer is "no", move the content to project-local `.claude/`, `CLAUDE.md`, `AGENTS.md`, or `docs/maintainer/`, or make it configurable in `harness.config.json`.

### 1.4 Placement rule

| Belongs in | Location |
|---|---|
| Shared, reusable, versioned behavior | Plugin (this repo) |
| Single-project customization | Consumer repo's `.claude/` or `CLAUDE.md` |
| Quick iteration, PoC, experiments | Consumer repo first, then port after reusability gate |

> **Official basis**
>
> Anthropic "Create plugins" explicitly states:
>
> > "Use standalone `.claude/` configuration for personal workflows, project-specific customizations, and quick experiments. Use plugins for shared, reusable, versioned behavior across projects and teams."
>
> Source: <https://code.claude.com/docs/en/plugins> (section: *When to use plugins vs standalone configuration*)
>
> Anthropic plugin reference defines plugins as "reusable packages of skills, agents, hooks, and related assets shipped from the plugin root."
>
> Source: <https://code.claude.com/docs/en/plugins-reference>

---

## Section 2 — Example Values Policy

All examples in shipped plugin files must be **generic, copy-safe, and obviously non-project-specific**.

### 2.1 Allowed generic values

| Category | Allowed values |
|---|---|
| Branch names | `main`, `dev`, `feature/example-feature`, `feature/add-example`, `fix/example-bug`, `feature/my-feature` |
| Project names | `example-app`, `sample-service`, `demo-plugin`, `my-project`, `your-repo` |
| Absolute paths | `/path/to/project`, `/path/to/worktree`, `/path/to/plugin-root` |
| Relative paths | `src/`, `app/`, `tests/`, `docs/`, `.claude/`, `harness.config.json` |
| File paths | `src/index.ts`, `app/main.py`, `tests/example.test.ts`, `docs/architecture.md` |
| API / endpoint names | `public API`, `existing endpoint`, `service client`, `main entrypoint`, `repository method` |

### 2.2 Disallowed real-world values in shipped plugin files

- Real project names used as development test beds (`parts-management` etc.)
- Project-specific branch names (`feature/new-partslist` etc.)
- Project-local business APIs (e.g. `upper_script`, `create_script_from_*`)
- Project-local operational files (e.g. `CLAUDE.local.md`, `next-session-prompt.md`)
- Paths that only make sense in one repository or one maintainer setup
- Locale-specific examples that imply a plugin-wide language policy
- Stack-specific commands presented as universal defaults, e.g. `PYTHONPATH=. pytest`, `ruff check backend/ && mypy backend/`
- Case-variant forms of internal tracker IDs presented as generic detection targets — e.g. broadening `gen-N` (lowercase ASCII, established consumer convention) to `Gen-N` / `GEN-N` collides with generic English (`Generation`, `Generic`, `GEN-LOCK`). Tracker-ID detection patterns must stay case-sensitive ASCII to keep false-positive rate near zero. See `plugins/harness/core/src/__tests__/generality.test.ts` for the full BLOCK_PATTERNS list (B-3f boundary regression block fixes the case-sensitive contract in CI).

### 2.3 Placeholder rules

- Use concrete generic values when text is likely to be copied or executed directly.
- Use `<your-...>` only when human replacement before execution is required and obvious.
- **Approved placeholder forms:** `<your-branch-name>`, `<your-project-root>`, `<your-worktree-dir>`, `<your-plugin-name>`, `<your-api-name>`
- Do not leave unresolved placeholders in executable shipped specs if Claude may pass them through literally.
- For runtime substitution, use officially supported mechanisms: `$ARGUMENTS`, `$ARGUMENTS[N]`, or config values. Never invent placeholder syntax.

### 2.4 Stack-specific examples

Label stack-specific examples explicitly:

```
Python example: PYTHONPATH=. pytest tests/
TypeScript example: npx vitest run
Optional Codex integration: ...
```

Never present a stack-specific example as the plugin-wide default.

> **Official basis**
>
> Anthropic skills docs define `$ARGUMENTS`, `$ARGUMENTS[N]`, and `$N` as the supported argument substitution mechanisms.
>
> Source: <https://code.claude.com/docs/en/skills> (section: *Pass arguments to skills*)
>
> Because shipped instructions persist in Claude's context, project-local values that enter shipped spec will affect all users silently.

---

## Section 3 — Self-Check Checklist for New Commands, Agents, and Hooks

**Do not open a PR until every item below is checked.** "It works in the test-bed project" is not sufficient. "It is understandable and safe for an unrelated repository" is the acceptance bar.

- [ ] **Blocklist B-1**: No specific branch names or repository-specific branch conventions remain in shipped spec.
- [ ] **Blocklist B-2**: No project-local business terms, API names, or directory names remain.
- [ ] **Blocklist B-3**: No internal tracker IDs, review-round IDs, handoff labels, or session markers remain in shipped spec or tests.
- [ ] **Blocklist B-4**: No project-local file names or maintainer-only operational files are *required* by shipped specs.
- [ ] **Blocklist B-5**: No stack-specific project checklist or command is presented as plugin-wide default behavior.
- [ ] **Language check**: `commands/`, `agents/`, `hooks/`, `plugin.json`, and `marketplace.json` are English-only or locale-neutral. Translations belong only under `docs/<locale>/`.
- [ ] **Optional dependency check**: Codex, CodeRabbit, and any third-party plugin or CLI remain optional, capability-detected, and documented with explicit fallback behavior.
- [ ] **Configurability check**: Any project path, command, branch rule, toolchain choice, or handoff file can be overridden via `harness.config.json` or project-local instructions instead of hardcoding.
- [ ] **Example values check**: Every example follows Section 2.
- [ ] **Test coverage — generality**: `plugins/harness/core/src/__tests__/generality.test.ts` is updated when a new leak pattern is introduced.
- [ ] **Test coverage — behavior**: Integrity or behavior tests are added when the change affects runtime behavior.
- [ ] **Exemption check**: Any `generality-exemption` comment in shipped spec follows [§3.1 Unified Exemption Grammar](#31-unified-exemption-grammar) AND is maintainer-approved with a linked tracking issue + expiry release.

> **Official basis**
>
> Anthropic skills docs note that skill content acts as standing instructions once invoked. Accidental project-local text in shipped specs persists across sessions and silently changes behavior for all users.
>
> Source: <https://code.claude.com/docs/en/skills>

### 3.1 Unified Exemption Grammar

Shipped spec may include a `generality-exemption` comment only when approved per [PR Review Flow §5](#pr-review-flow) (linked issue + expiry release). The comment **must** follow the pipe-separated, 4-field grammar enforced by `plugins/harness/core/src/__tests__/generality.test.ts`.

**Format**: `generality-exemption: <pattern-ids> | <issue-key> | <expiry> | <reason>`

| Field | Required | Format | Examples |
| --- | --- | --- | --- |
| pattern-ids | yes | `B-\d+[a-z]?` CSV. `all` is rejected. | `B-1`, `B-1,B-2a,B-3c` |
| issue-key | yes | `[A-Z][A-Z0-9_]*-[A-Za-z0-9_-]+`. Semantic slugs allowed (e.g. self-reference). | `HARNESS-42`, `HARNESS-generality-self`, `PARTS-12` |
| expiry | yes | semver `vX.Y.Z` \| ISO date `YYYY-MM-DD` \| quarter `YYYY-Qn`. | `v0.5.0`, `2026-12-31`, `2026-Q2` |
| reason | yes | Free text, 1 line. | `detector self-reference unavoidable until v1.0 redesign` |

**Placement**:

```md
<!-- generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale -->
```

```ts
/* generality-exemption: B-1,B-2a | HARNESS-42 | v0.5.0 | rationale */
const branch = "feature/example-feature"; // generality-exemption: B-1 | HARNESS-42 | v0.5.0 | test fixture
```

**Line-level short form** (may omit metadata when the file head already declares it): `// generality-exemption: B-1` or `// generality-exemption: B-1,B-2a`.

**Legacy forms rejected** (unified exemption grammar):

- em dash (`—`) + comma separators
- bare `generality-ok` keyword at line level (now unified to `generality-exemption`)
- `all` as a pattern-id

> **Design basis**
>
> Anthropic plugin/skill docs do not specify exemption grammar. The grammar is modelled after ESLint `// eslint-disable-next-line <rule> -- <reason>` and RuboCop `# rubocop:disable Cop/Name` with stricter issue-key + expiry requirements to enforce the release-gate in [PR Review Flow §5](#pr-review-flow).
>
> Source: <https://code.claude.com/docs/en/plugins>

---

## Section 4 — Internal Tracker IDs and Handoff Labels

Internal tracker IDs are maintainer metadata, not plugin behavior.

### 4.1 Allowed locations

- Commit messages
- `CHANGELOG.md`
- `docs/maintainer/**`
- PR descriptions
- Issue comments
- Release notes targeted at maintainers

### 4.2 Disallowed locations

| Location | Why |
|---|---|
| `commands/`, `agents/`, `hooks/` | Shipped spec — users read these |
| `plugin.json`, `marketplace.json` | Manifest — installed by users |
| Config schema defaults | Visible at setup time |
| User-facing examples | Misleads unrelated users |
| Test `describe()` / `it()` titles | Test output is user-visible in CI |
| Hook `statusMessage` | Shown to user during hook execution |
| Any string read during normal plugin use | Same as above |

### 4.3 Migration policy for existing IDs

1. Freeze the old-to-new mapping in `docs/maintainer/tracker-migration.md`.
2. Remove labels such as `Phase N 申送`, `Round N`, `A-N rM` from shipped specs and test titles.
3. If a maintainer-visible reference must remain, replace with a generic issue key such as `HARNESS-12`, confined only to allowed maintainer locations.
4. After one release cycle, retire old aliases from active maintainer docs if no longer needed.

### 4.4 Naming rule

- User-facing plugin text must describe **behavior**, not internal history.
- Prefer `profile propagation regression` over `A-N rM Major-L`.
- Prefer `follow-up tracked in HARNESS-12` over raw handoff labels.

---

## Section 5 — Test Bed Project Policy

Development is validated through **test-bed projects**. A test bed is a **proving ground, not the specification**.

### 5.1 Required order (R-Flow)

```
1. Build the idea in the test-bed project as project-local customization.
2. Validate in real usage.
3. Apply the reusability gate (R1 + R2 below).
4. Only then port the reusable invariant into the plugin.
5. Record the experiment in docs/maintainer/test-bed-usage.md.
6. Add generality tests before merging the plugin PR.
```

### 5.2 Forbidden order

Do not write directly into plugin core first and "verify later" in the test-bed project.

### 5.3 R1 — Reusability gate

Port to plugin only if the behavior still makes sense after replacing:

- project name
- branch names
- file layout
- language stack
- locale

If the behavior needs one repository's business nouns or operator conventions to remain understandable, it **fails R1** and stays local.

### 5.4 R2 — Business logic isolation

The following must stay project-local:

- Business workflows and domain nouns
- Project file names and directory layouts
- API names and branch conventions
- Human handoff files and team-specific release choreography

The plugin may keep only the **reusable invariant**, for example:

| Local (must stay out) | Plugin (invariant only) |
|---|---|
| Requires `next-session-prompt.md` | Accepts configurable handoff file path |
| Requires `feature/new-partslist` | Accepts configurable integration branch |
| Requires `ruff check backend/` | Accepts configurable lint command list |

### 5.5 Required record for every test-bed-derived plugin change

Add an entry to `docs/maintainer/test-bed-usage.md`:

- Test-bed repo and commit/branch
- Local-only implementation path
- Observed benefit
- Reusable invariant extracted
- Project-local assumptions rejected
- Config knobs introduced in plugin
- `generality.test.ts` assertions added

> **Official basis**
>
> Anthropic explicitly recommends starting with standalone `.claude/` for quick iteration and experiments, then converting to a plugin when ready to share.
>
> Source: <https://code.claude.com/docs/en/plugins>

---

## Section 6 — Official Plugin Spec Alignment

### 6.1 Manifest responsibilities

| File | Purpose |
|---|---|
| `.claude-plugin/marketplace.json` | Claude Code marketplace catalog: public marketplace owner + installable plugin entry |
| `plugins/harness/.claude-plugin/plugin.json` | Plugin manifest: metadata + plugin-owned component definitions |
| `.agents/plugins/marketplace.json` | Codex marketplace catalog: repo-local marketplace + installable Codex adapter entry |
| `plugins/codex-harness/.codex-plugin/plugin.json` | Codex plugin manifest: metadata + skill entrypoint discovery |

### 6.2 Schema rules

- Keep plugin components at the plugin root. Only `plugin.json` inside `.claude-plugin/`.
- If the plugin uses custom component paths, define them in `plugin.json`.
- For new multi-file reusable skills, prefer `skills/` over `commands/` unless backward compatibility requires otherwise.

### 6.3 Marketplace rules

- Claude Code marketplace files must define `name`, `owner`, and `plugins`.
- Claude Code plugin entries must define `name` and `source`.
- Keep Claude Code `strict: true` unless intentionally curating plugin components differently from the plugin repo.
- Codex marketplace files live at `.agents/plugins/marketplace.json`.
- Codex plugin entries must define `name`, `source`, `policy`, and `category`.
- Codex `source.path` must stay repo-relative, for example `./plugins/codex-harness`.

### 6.4 Versioning (semver)

| Bump | When |
|---|---|
| MAJOR | Breaking change to command / agent / hook / config behavior |
| MINOR | Backward-compatible new feature |
| PATCH | Backward-compatible fix, including leak removal and example cleanup |

- Update the release version before distribution.
- Record all user-visible changes in `CHANGELOG.md`.
- If `plugin.json` carries `version`, it must match the released version. If `marketplace.json` is the version authority, omit plugin `version` and document that fact. Never leave two conflicting sources.

### 6.5 License

- Use an SPDX identifier in plugin metadata (e.g. `MIT`, `Apache-2.0`).
- The manifest `license` field must match the repository `LICENSE` file.
- Do not publish a marketplace entry without a declared license.

### 6.6 Release gate

No release if:

- [ ] Generality checks (`generality.test.ts`) fail
- [ ] Project-local values remain in shipped spec
- [ ] `plugin.json`, `marketplace.json`, `CHANGELOG.md`, and `LICENSE` disagree with each other

> **Official basis**
>
> Anthropic plugin reference documents `plugin.json` manifest fields (name, version, description, author, homepage, repository, license) and semver update caching behavior.
>
> Source: <https://code.claude.com/docs/en/plugins-reference>
>
> Anthropic marketplace docs define `marketplace.json` schema, plugin entry fields, strict mode, and SPDX license usage.
>
> Source: <https://code.claude.com/docs/en/plugin-marketplaces>

---

## Section 7 — Public Surface and Local Self-Hosting Boundary

This repository is public, while the harness is also used to develop itself. Keep these surfaces separate.

Public, tracked surface:

- `.claude-plugin/**`: Claude Code marketplace catalog for this public plugin.
- `.agents/plugins/**`: Codex marketplace catalog for repo-local Codex adapter install.
- `plugins/harness/**`: shipped plugin implementation, commands, agents, hooks, schemas, and committed `dist` artifacts.
- `plugins/codex-harness/**`: Codex-native adapter implementation, manifest, and skills.
- `template/**`: files installed into consumer projects.
- `docs/en/**`, `docs/ja/**`, `README.md`, `CHANGELOG.md`, and generic maintainer process docs.
- `harness.config.example.json`: public example for local self-hosting config shape.

Local-only self-hosting surface:

- `harness.config.json`: live config for developing this repository with the harness itself. Git ignores it.
- `.docs/handoff/**`: active handoff, backlog, roadmap, and decision notes. Git ignores it.
- Sibling-repository snapshots, personal absolute paths, active branch notes, and untriaged test-bed material.

Rules:

- Do not commit live self-hosting config or handoff state.
- Do not move private handoff notes into `docs/maintainer/**` unless they have been rewritten as generic public maintainer guidance.
- Release PRs must keep `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff` empty.
- `content-integrity.test.ts` enforces this boundary in CI.

---

## Section 8 — Maintainer Branch Strategy

This repository uses a three-branch maintainer flow:

```text
feature/* -> dev -> main
```

Branch roles:

- `main`: public, stable, release-ready. No direct implementation work.
- `dev`: next-release integration branch.
- `feature/*`: short-lived implementation branches, cut from `dev`.

Normal feature PRs target `dev`. `main` receives changes only through a release PR from `dev`.

Before starting work:

```bash
cd /path/to/cc-triad-relay
git switch dev
git pull --ff-only
git status --short --branch
git switch -c feature/<short-slug>
```

Before release:

```bash
git switch dev
git pull --ff-only
npm test --workspace=plugins/harness/core
npm run build
```

Then open:

```text
base: main
compare: dev
```

The operational runbook lives in [`docs/maintainer/development-branching.md`](docs/maintainer/development-branching.md).

---

## PR Review Flow

1. Author completes Section 3 self-check before opening a PR. Any unchecked item blocks PR creation.
2. Reviewer who finds a leak marks it as `core-leak` and treats it as a **release blocker**, not a documentation nit.
3. Author resolves using exactly one of:
   - a. Move to project-local `.claude/` or `CLAUDE.md` in the consumer repo.
   - b. Generalize using Section 2 example values.
   - c. Make configurable via `harness.config.json`.
4. Resolution without an updated generality test is incomplete.
5. Exceptions require two maintainer approvals plus a linked issue and an expiry release. Permanent exemptions in shipped spec are prohibited.
6. Release reviewer verifies `plugin.json`, `marketplace.json`, `CHANGELOG.md`, `LICENSE`, and generality tests before merge.

---

## Related Documentation

- [`plugins/harness/core/src/__tests__/generality.test.ts`](plugins/harness/core/src/__tests__/generality.test.ts) — Static leak detector (CI blocking)
- [`.github/pull_request_template.md`](.github/pull_request_template.md) — PR checklist
- [`docs/maintainer/test-bed-usage.md`](docs/maintainer/test-bed-usage.md) — Test bed usage log
- [`docs/maintainer/development-branching.md`](docs/maintainer/development-branching.md) — Maintainer branch flow
- [`harness.config.example.json`](harness.config.example.json) — Example local self-hosting config
- [`CHANGELOG.md`](CHANGELOG.md) — Release notes
