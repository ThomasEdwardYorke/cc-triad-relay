# Maintainer Branch Strategy

This repository uses a three-branch maintainer flow to keep `main` release-ready while active work integrates through `dev`.

```text
main        = public, stable, release-ready
dev         = next release integration branch
feature/*   = short-lived implementation branches
```

## Public vs Local State

Tracked files are public. Keep live self-hosting state out of tracked paths:

- Use local `harness.config.json` for this repository development. It is ignored by Git.
- Use `.docs/handoff/**` for active handoff, backlog, roadmap, and decision notes. It is ignored by Git.
- Use `harness.config.example.json` as the public template for the local config shape.
- Do not commit personal absolute paths, sibling-repository handoff snapshots, active branch notes, or untriaged test-bed material.

The CI content-integrity guard fails if live self-hosting config or the old tracked handoff directory re-enters the repository surface.

## Normal Development

Start every task from `dev`:

```bash
cd /path/to/cc-triad-relay
git switch dev
git pull --ff-only
git status --short --branch
git switch -c feature/<short-slug>
```

After implementation, tests, and commit:

```bash
git push -u origin feature/<short-slug>
```

Open the PR with:

```text
base: dev
compare: feature/<short-slug>
```

Do not open normal feature PRs directly into `main`.

## Release Flow

When `dev` is ready to publish:

```bash
git switch dev
git pull --ff-only
npm test --workspace=plugins/harness/core
npm run build
git ls-files -- harness.config.json docs/maintainer/handoff
```

The final command must print nothing. If it prints paths, stop and remove the local-only state from Git before opening a release PR.

Open a release PR with:

```text
base: main
compare: dev
```

After the release PR merges:

```bash
git switch main
git pull --ff-only
git tag -a v<version> -m "release: v<version>"
git push origin v<version>
git switch dev
git pull --ff-only
```

## GitHub Branch Protection

Recommended repository settings:

- Protect `main`.
- Require PRs before merging to `main`.
- Require CI before merging to `main`.
- Disallow direct pushes to `main`.
- Require branch to be up to date before merge when practical.
- Prefer linear history if the repo keeps squash/rebase-only merges.
- Protect `dev` with the same PR-only rule when team size or automation warrants it.

## Cleanup

After a feature PR is merged into `dev`, delete the local feature branch:

```bash
git branch -d feature/<short-slug>
```

Remote branch deletion is a separate cleanup step. Run it during release
cleanup, or earlier only when the branch is explicitly safe to remove:

```bash
git push origin --delete feature/<short-slug>
git fetch origin --prune
```

Only delete a remote branch after checking that all of these remote-deletion gates pass:

- no open PR uses the branch;
- no closed-but-unmerged PR still points at the current branch head;
- the branch head is contained in `origin/dev`, or the branch was explicitly superseded;
- the branch head is contained in `origin/main` before release cleanup;
- no release dependency, rollback note, or maintainer audit asks to retain it.

## Remote Branch Cleanup Audit

### 2026-05-12 - Historical model branches

Audit command set: `git fetch origin --prune`, `git ls-remote --heads`,
`gh pr list --state all`, `git branch -r --contains`, and
`git log --left-right --cherry-pick`.

| Branch | Head | PR evidence | Merge-containment evidence | Decision |
| --- | --- | --- | --- | --- |
| `feature/model-b-evolution` | `51df84a` | PR #17 is closed without merge at this head; older PR #1 and PR #2 were merged at earlier heads. | Branch head is not contained in `origin/dev` or `origin/main`; one unique commit remains versus `origin/dev`. | retain; not deleted. |
| `feature/model-registry` | `f5d43a1` | No open PR was found in the checked PR list. | Branch head is not contained in `origin/dev` or `origin/main`; 9 unique commits remain versus `origin/dev`. | retain; not deleted. |

No remote branches were deleted in this audit because both targets still fail
the no-unmerged-work gate.
