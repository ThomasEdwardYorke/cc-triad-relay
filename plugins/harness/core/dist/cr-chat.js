/**
 * core/src/cr-chat.ts
 *
 * CodeRabbit chat command builder.
 *
 * IMPORTANT (bucket attribution caveat):
 *   CodeRabbit 公式 docs (https://docs.coderabbit.ai/reference/review-commands,
 *   https://docs.coderabbit.ai/guides/commands) は review bucket (5/h) と
 *   chat bucket (50/h) の **command-level mapping を明示的に publish して
 *   いない**。本 module は以下を仮定する:
 *
 *   - **CONFIRMED (high confidence)**: `review` / `full review` は review bucket
 *     公式 docs で "review commands" として明示
 *   - **ASSUMED (medium confidence、empirical 検証必要)**: `resolve` / `summary`
 *     / `configuration` / `help` は chat bucket。bucket model の論理的推定 +
 *     非 review nature に基づく
 *
 *   採用時は `commands/coderabbit-review.md` Step 2.6.3 の empirical 検証手順
 *   (escape hatch 付き、最大 5 試行で bucket 確定) を実施し、結果を「empirical
 *   検証ログ」に記録すること。検証で chat bucket 帰属が外れた command は
 *   `CHAT_BUCKET_COMMANDS` から除外し、本 docstring の VERIFIED 集合に
 *   昇格させる。
 *
 *   See also: .tmp/cr-research/02-chat-bucket.md (research log)
 *
 * Design invariants:
 *   - chat bucket 用 commands (ASSUMED): resolve / summary / configuration / help (4 件)
 *   - review bucket 用 commands (CONFIRMED): review / full review (2 件)
 *   - 両 set は disjoke (混入禁止) — runtime test で enforce
 *   - buildChatCommand に review bucket commands を渡すと throw (call site で
 *     review bucket 消費を明示するための **設計防御**、security boundary ではない:
 *     利用者が `gh pr comment "@coderabbitai review"` を直打ちすれば bypass 可能)
 *   - command body は `@coderabbitai <command>` で始まる (公式 docs syntax)
 */
export const CHAT_BUCKET_COMMANDS = [
    "resolve",
    "summary",
    "configuration",
    "help",
];
export const REVIEW_BUCKET_COMMANDS = ["review", "full review"];
/**
 * Classify a command name into "chat" | "review" | "unknown" bucket.
 *
 * Used by callers to decide whether to gate a comment behind the review
 * 5/h limit or use the wider 50/h chat bucket.
 */
export function classifyBucket(cmd) {
    if (CHAT_BUCKET_COMMANDS.includes(cmd)) {
        return "chat";
    }
    if (REVIEW_BUCKET_COMMANDS.includes(cmd)) {
        return "review";
    }
    return "unknown";
}
/**
 * Build a `@coderabbitai <command>` string suitable for `gh pr comment`.
 *
 * Throws when:
 *   - cmd is unknown (not in chat or review set)
 *   - cmd is a review trigger (must be sent through the review-trigger flow,
 *     not the chat helper, to make the bucket consumption explicit at call site)
 *
 * `body` (optional) is appended on a blank line so the bot recognizes the
 * command on the first line and treats subsequent text as natural-language
 * context.
 */
export function buildChatCommand(cmd, body) {
    const bucket = classifyBucket(cmd);
    if (bucket === "review") {
        throw new Error(`'${cmd}' belongs to the review bucket; use review trigger flow (e.g. gh pr comment "@coderabbitai review") instead of the chat helper.`);
    }
    if (bucket !== "chat") {
        throw new Error(`Unknown chat command: '${cmd}'`);
    }
    const head = `@coderabbitai ${cmd}`;
    if (body !== undefined && body.trim() !== "") {
        return `${head}\n\n${body.trim()}`;
    }
    return head;
}
//# sourceMappingURL=cr-chat.js.map