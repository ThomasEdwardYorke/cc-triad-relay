# Codex Harness Adapter

This plugin is the Codex-native adapter for the cc-triad-relay Harness. It
exposes skills instead of command or agent files, while keeping the same
workflow intent: repository checks, TDD, handoff hygiene, local review, CI, and
CodeRabbit-aware PR follow-up.

Install it from a checkout of this repository:

```bash
codex plugin marketplace add /path/to/project
```

Then enable `codex-harness` from this repository marketplace.

## Entry Skills

- `harness-work`: choose the right work mode and dispatch a task through the quality gates.
- `tdd-implement`: run one implementation task through RED, GREEN, refactor, and review.
- `session-handoff`: inspect or update handoff files without leaking local state into the public repo.
- `coderabbit-review`: inspect PR review feedback and keep fixes scoped to actionable findings.
- `pseudo-coderabbit-loop`: run a local CodeRabbit-style pre-review before pushing.

## Boundary

Codex metadata lives in this plugin root. Claude Code adapter metadata lives in
its own adapter root. Shared behavior should be expressed as portable workflow
rules, not copied platform-specific metadata.
