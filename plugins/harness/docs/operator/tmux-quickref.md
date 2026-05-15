# Model B Tmux Quickref

Use this when `/parallel-worktree-v2` has started a Model B tmux session and you need to inspect or resume a worker. `<session>` is the active tmux session name, defaulting to `harness-parallel` unless `TMUX_SESSION_NAME` was set.

1. Show worker state: `/parallel-worktree-v2 status`
2. Attach one worker: `/parallel-worktree-v2 attach <slug>`
3. Detach without stopping work: `Ctrl-b d`
4. List windows: `tmux list-windows -t <session>`
5. Jump to a worker window: `tmux select-window -t <session>:<slug>`
6. Read the latest pane output: `tmux capture-pane -p -t <session>:<slug>.0`
7. Rename idle pane titles only: `<launcher> label-panes <session> <slug=title>...`
8. Re-run skill checks after attach: `/parallel-worktree-v2 verify <slug>`
9. Stop tmux only: `/parallel-worktree-v2 stop`
10. Crash cleanup preview: `<launcher> --dry-run stop --rollback <session> <slug...>`

Keep tmux window names stable as slugs; use pane titles for presentation labels.
