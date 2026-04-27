/**
 * hooks/stop.ts
 *
 * Stop hook handler.
 * Fires when Claude finishes responding. Reads project config via
 * `loadConfigWithError` so that partial `work.qualityGates` overrides
 * inherit the other gate defaults **and** so that a malformed config
 * file is not silently treated the same as a pristine config — a
 * broken file suppresses the reminders entirely (avoids the
 * silent-swallow failure mode where `loadConfigSafe` would emit every
 * default reminder even when the user never validly authored them).
 */
export interface StopInput {
    hook_event_name: string;
    session_id?: string | undefined;
    cwd?: string | undefined;
    /**
     * Anthropic Claude Code Stop hook spec (https://code.claude.com/docs/en/hooks)
     * は Stop event payload として `last_assistant_message` を deliver する。
     * 現 handler は参照しないが、subagent-stop.ts と同型 declare で公式 spec
     * との対称性を維持する。dispatcher 経路で extractString propagate 済。
     */
    last_assistant_message?: string | undefined;
    stop_hook_active?: boolean | undefined;
}
export interface StopResult {
    decision: "approve";
    additionalContext?: string;
}
export declare function handleStop(input: StopInput): Promise<StopResult>;
//# sourceMappingURL=stop.d.ts.map