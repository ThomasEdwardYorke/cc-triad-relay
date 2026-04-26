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
export const VALID_PROFILES = ["chill", "assertive", "strict"];
/** Upstream CodeRabbit allowlist (no `strict`). Used to validate yamlProfile. */
const UPSTREAM_PROFILES = ["chill", "assertive"];
function isValidProfile(value) {
    return VALID_PROFILES.includes(value);
}
function isUpstreamProfile(value) {
    return UPSTREAM_PROFILES.includes(value);
}
/**
 * Resolve the effective profile by walking the precedence chain.
 * Pure function — no env / fs reads.
 */
export function resolveProfile(input) {
    const warnings = [];
    const allowStrict = input.allowStrict ?? true;
    // 1. cliFlag (highest)
    const cliRaw = (input.cliFlag ?? "").trim();
    if (cliRaw.length > 0) {
        if (isValidProfile(cliRaw)) {
            if (cliRaw === "strict" && !allowStrict) {
                warnings.push(`cli profile='strict' is not allowed in this context (allowStrict=false); falling through.`);
            }
            else {
                return { profile: cliRaw, source: "cli", warnings };
            }
        }
        else {
            warnings.push(`cli profile='${cliRaw}' is invalid (must be one of ${VALID_PROFILES.join("/")}); falling through.`);
        }
    }
    // 2. env HARNESS_CR_PROFILE
    const envRaw = (input.env ?? "").trim();
    if (envRaw.length > 0) {
        if (isValidProfile(envRaw)) {
            if (envRaw === "strict" && !allowStrict) {
                warnings.push(`env HARNESS_CR_PROFILE='strict' is not allowed in this context (allowStrict=false); falling through.`);
            }
            else {
                return { profile: envRaw, source: "env", warnings };
            }
        }
        else {
            warnings.push(`env HARNESS_CR_PROFILE='${envRaw}' is invalid (must be one of ${VALID_PROFILES.join("/")}); falling through.`);
        }
    }
    // 3. harnessConfigProfile (already typed, but allowStrict gate may apply)
    if (input.harnessConfigProfile !== undefined) {
        const cfg = input.harnessConfigProfile;
        if (cfg === "strict" && !allowStrict) {
            warnings.push(`harness.config.json profile='strict' is not allowed in this context (allowStrict=false); falling through.`);
        }
        else {
            return { profile: cfg, source: "harness-config", warnings };
        }
    }
    // 4. yamlProfile (CodeRabbit upstream allowlist only — strict rejected)
    const yamlRaw = (input.yamlProfile ?? "").trim();
    if (yamlRaw.length > 0) {
        if (isUpstreamProfile(yamlRaw)) {
            return { profile: yamlRaw, source: "coderabbit-yaml", warnings };
        }
        warnings.push(`.coderabbit.yaml profile='${yamlRaw}' is outside CodeRabbit upstream allowlist (chill/assertive); falling through to default.`);
    }
    // 5. default
    return { profile: "chill", source: "default", warnings };
}
//# sourceMappingURL=profile-resolver.js.map