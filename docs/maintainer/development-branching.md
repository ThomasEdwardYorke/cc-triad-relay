# Maintainer Branch Strategy

This repository uses a three-branch maintainer flow to keep `main` release-ready.

```text
main        = public, stable, release-ready
dev         = next release integration branch
feature/*   = short-lived implementation branches
```

## Normal Development

Start every task from `dev`:

```bash
cd /Users/kosukekunii/dev/cc-triad-relay
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
```

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

After a feature PR is merged into `dev`, delete the feature branch locally and remotely:

```bash
git branch -d feature/<short-slug>
git push origin --delete feature/<short-slug>
git fetch origin --prune
```

Only delete remote branches after checking that no open PR uses them.
