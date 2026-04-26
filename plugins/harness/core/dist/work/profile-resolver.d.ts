/**
 * core/src/work/profile-resolver.ts
 *
 * Pure-function resolver that determines the effective Pseudo / Real
 * CodeRabbit review profile for a single skill invocation.
 *
 * Precedence chain (highest first):
 *   1. cliFlag                  — `--profile=<value>` flag from the skill caller
 *   2. env                      — `HARNESS_CR_PROFILE` environment variable
 *   3. harnessConfigProfile     — `harness.config.json.tddEnforce.pseudoCoderabbitProfile`
 *   4. yamlProfile              — `.coderabbit.yaml.reviews.profile`
 *   5. default                  — `chill`
 *
 * Each input is validated against `VALID_PROFILES`. Invalid values emit
 * a warning and fall through to the next source (graceful degradation
 * rather than throw — caller may continue with default profile and
 * surface the warnings to the user).
 *
 * `strict` is a harness-local extension. CodeRabbit's official `reviews.profile`
 * schema (verified 2026-04 against https://docs.coderabbit.ai/reference/configuration)
 * accepts only `chill` / `assertive`. Therefore:
 *   - cliFlag / env / harnessConfigProfile may carry `strict` (harness-side
 *     entry points understand the extension).
 *   - yamlProfile may NOT carry `strict` — the resolver treats it as invalid
 *     and falls through, since the consumer's downstream CodeRabbit pipeline
 *     would also reject it.
 *
 * Set `allowStrict=false` to forbid `strict` even on harness-side entry points
 * (used by skills that hand profile values directly to CodeRabbit Cloud).
 */
/** Allowed CodeRabbit profile values across all entry points. */
export declare const VALID_PROFILES: readonly ["chill", "assertive", "strict"];
export type CoderabbitProfile = (typeof VALID_PROFILES)[number];
/** Source from which the resolved profile was taken. */
export type ProfileSource = "cli" | "env" | "harness-config" | "coderabbit-yaml" | "default";
export interface ProfileResolverInput {
    /** `--profile=<value>` flag value (highest precedence). Undefined / empty → ignored. */
    cliFlag?: string;
    /** `HARNESS_CR_PROFILE` env value. Undefined / empty / whitespace → ignored. */
    env?: string;
    /**
     * `harness.config.json.tddEnforce.pseudoCoderabbitProfile`. Already validated
     * by `loadConfig`, so the resolver trusts the value and does not warn on it
     * unless `allowStrict=false` rejects `strict`.
     */
    harnessConfigProfile?: CoderabbitProfile;
    /**
     * `.coderabbit.yaml.reviews.profile` raw string. May be invalid (e.g. `strict`,
     * which is harness-local only). Validated against the upstream CodeRabbit
     * allowlist (`chill` / `assertive`) — anything else falls through with a warning.
     */
    yamlProfile?: string;
    /**
     * When false, `strict` is rejected on every source (used by skills that
     * forward the profile directly to CodeRabbit Cloud). Default `true`
     * (harness-side entry points accept the extension).
     */
    allowStrict?: boolean;
}
export interface ProfileResolution {
    profile: CoderabbitProfile;
    source: ProfileSource;
    warnings: string[];
}
/**
 * Resolve the effective profile by walking the precedence chain.
 * Pure function — no env / fs reads.
 */
export declare function resolveProfile(input: ProfileResolverInput): ProfileResolution;
//# sourceMappingURL=profile-resolver.d.ts.map