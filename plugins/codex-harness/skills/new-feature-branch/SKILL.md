---
name: new-feature-branch
description: Create a feature branch from the integration branch after checking repository, branch, and local-only safety.
---

# new-feature-branch

Use this skill when the user asks Codex to start a new unit of work in a clean feature branch.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the git worktree and current branch before changing branches.
   - Fetch remotes before comparing the integration branch and release branch.
   - Work from the project's integration branch, defaulting to `dev` when the project does not say otherwise.
2. Branch safety gate
   - Confirm the release branch, defaulting to `main`, does not contain commits missing from the integration branch.
   - If the branches diverged, stop and report the commit ranges instead of auto-resolving.
   - Create only `feature/*` branches for normal implementation work.
3. RED gate
   - Treat a dirty worktree, ambiguous base branch, existing branch name, or diverged release/integration pair as the failing precondition.
   - Do not continue until the failing precondition is resolved or explicitly deferred by the user.
4. GREEN gate
   - Create the feature branch from the verified integration branch.
   - Push with upstream only after the branch name and base are confirmed.
5. Local review gate
   - Recheck the branch name, upstream, and diff surface after creation.
   - Confirm no implementation files changed during branch setup.
6. CI and CodeRabbit gate
   - Branch creation does not require PR CI.
   - If a draft PR is opened immediately, target the integration branch, not the release branch.
7. Release-to-main gate
   - Normal feature work targets the integration branch.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
8. Local-only boundary gate
   - Before reporting success, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Workflow

1. Fetch remotes and compare release branch to integration branch.
2. Fast-forward local integration branch only when it is safely behind its remote.
3. Create the requested `feature/*` branch from the integration branch.
4. Optionally push the new branch and open a draft PR against the integration branch.

## Completion Contract

Report the new branch, base branch, remote tracking state, release-to-main gate status, local-only boundary status, and any unresolved branch health warnings.
