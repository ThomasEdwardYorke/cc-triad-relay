---
name: harness-release
description: Prepare a release from the integration branch to the release branch through a guarded release PR.
---

# harness-release

Use this skill when the user asks Codex to publish the integration branch, prepare a release PR, bump a version, or verify release readiness.

## Codex-Native Gates

1. Repository and branch gate
   - Resolve the repository, integration branch, release branch, and current dirty status.
   - Default to `dev` as integration branch and `main` as release branch only when the project does not override them.
2. Branch safety gate
   - Confirm the integration branch is at or ahead of the release branch.
   - If the release branch has commits missing from integration, stop and require a safe resync.
   - Do not perform release work from a feature branch.
3. RED gate
   - Treat failing tests, untracked release-critical files, version drift, or tracked local-only state as failing release preconditions.
   - Capture the exact failing command or file list.
4. GREEN gate
   - Prepare only the minimum release changes needed, such as version or changelog updates when requested.
   - Re-run the release checks after any release-prep edit.
5. Local review gate
   - Review the release diff from release branch to integration branch.
   - Confirm the diff contains no active handoff state, personal paths, or sibling-repository snapshots.
6. CI and CodeRabbit gate
   - Require release PR CI and CodeRabbit to be clean before merge.
   - A local-only dry run may stop after reporting the release PR readiness state.
7. Codex second-opinion gate
   - Required before reporting a release PR or release merge as clear.
   - Provide the independent reviewer with the current diff, PR context, and test results.
   - Require the reviewer to return `PASS | NEEDS_FIX | BLOCKED` plus actionable findings.
   - Capability ladder:
     1. Codex sub-agent, when the current Codex runtime exposes delegated review.
     2. `codex` CLI, when a repo-local or PATH-available CLI is authenticated.
     3. If neither path is available, fail-closed with `BLOCKED`.
   - Do not mark the release clear until the second opinion returns `PASS`.
8. Release-to-main gate
   - Release branch exposure must happen through a release PR from integration to release branch.
   - Do not push directly to `main`; `main` exposure happens only through a release PR.
9. Local-only boundary gate
   - Before opening or merging a release PR, run `git ls-files -- harness.config.json docs/maintainer/handoff .docs/handoff`.
   - The command must print no tracked local-only files.

## Workflow

1. Verify branch relationship and local-only boundary.
2. Run the repository release checks from the integration branch.
3. Prepare release metadata only when requested.
4. Open or verify a release PR from integration branch to release branch.
5. Merge the release PR only after CI, CodeRabbit, and Codex second opinion are clear.

## Completion Contract

Report the integration branch, release branch, release PR, tests, CodeRabbit status, second-opinion status, release-to-main gate status, and local-only boundary status.
