/**
 * hooks/subagent-stop.ts
 *
 * SubagentStop hook handler.
 * Fires when a subagent completes. For worker agents, runs a lightweight
 * CI safety net (ruff/mypy/pytest) to catch regressions before the
 * coordinator proceeds.
 */
export interface SubagentStopInput {
    hook_event_name: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    agent_type?: string | undefined;
    agent_id?: string | undefined;
    agent_transcript_path?: string | undefined;
    last_assistant_message?: string | undefined;
    /**
     * Anthropic SubagentStop spec field
     * (https://code.claude.com/docs/en/hooks). When `true`, this hook is
     * firing recursively because a prior Stop / SubagentStop decision
     * caused continuation. Running CI again would create an infinite
     * loop, so the handler short-circuits to a bare approve. Mirrors the
     * same field already honored by `stop.ts`.
     */
    stop_hook_active?: boolean | undefined;
}
export interface CiCheckResult {
    tool: string;
    passed: boolean;
    output: string;
}
export interface SubagentStopResult {
    decision: "approve";
    ciTriggered: boolean;
    ciResults?: CiCheckResult[];
    additionalContext?: string;
}
export declare function detectAvailableChecks(projectRoot: string): Array<{
    tool: string;
    command: string;
}>;
export declare function handleSubagentStop(input: SubagentStopInput): Promise<SubagentStopResult>;
//# sourceMappingURL=subagent-stop.d.ts.map