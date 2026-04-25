/**
 * core/src/work/backlog-parser.ts
 *
 * Parser for the 4-layer handoff backlog file. Reads a Markdown file
 * whose entries follow this grammar:
 *
 *   ### [Critical|High|Med|Low] <id> <title>
 *   ```yaml
 *   id: ...
 *   priority: ...
 *   status: ...
 *   roadmap_ref: ...
 *   worktree: ...
 *   pr: ...
 *   ```
 *
 * Each level-3 heading that matches the bracketed-priority pattern is
 * one entry. The optional fenced YAML block immediately following the
 * heading (only `yaml` / `YAML` info-strings count) supplies machine-
 * readable metadata; values there override the heading-derived defaults.
 *
 * Design notes:
 * - The parser is hand-rolled (no `js-yaml` / `yaml` runtime dependency
 *   in the consumer surface). The handoff backlog YAML is intentionally
 *   limited to flat `key: value` pairs — nested structures, multi-line
 *   strings, and lists are not part of the grammar. The hand-rolled
 *   parser keeps the dependency footprint minimal and surfaces malformed
 *   input as a stderr warning rather than a thrown error.
 * - Entries are returned in file order. The dispatcher applies its own
 *   priority / dependency ordering — losing file order would make
 *   editor-driven authoring (where the human places a new entry near
 *   related context) feel non-deterministic.
 * - Missing files yield `[]` (no throw). The handoff backlog may not
 *   exist yet for a freshly-initialised project; consumers (skills)
 *   should treat absence as "no pending work" rather than an error.
 */
export type BacklogPriority = "Critical" | "High" | "Med" | "Low";
export type BacklogStatus = "pending" | "in_progress" | "review" | "done";
export interface BacklogEntry {
    /** Stable identifier (heading or YAML override). */
    id: string;
    /** Priority bucket controlling dispatcher ordering. */
    priority: BacklogPriority;
    /** Lifecycle state — defaults to `pending` when absent. */
    status: BacklogStatus;
    /** Title text from the heading (everything after `<id> `). */
    title: string;
    /** Optional pointer into the roadmap layer (e.g. `phase-1.week-2`). */
    roadmapRef?: string;
    /** Optional worktree path that is currently driving this entry. */
    worktree?: string;
    /** Optional pull request reference (the value is preserved verbatim). */
    pr?: string;
    /** Verbatim heading line (useful for diagnostics / preview UIs). */
    rawHeading: string;
    /** 1-indexed line number of the heading in the source file. */
    lineNumber: number;
}
/**
 * Parse a backlog markdown file at `filepath`. Returns the entries in
 * file order. Missing files yield `[]` (no throw). Parse errors on
 * individual entries are surfaced via stderr warnings; the parser does
 * its best to extract the rest of the file rather than failing the
 * whole dispatch.
 */
export declare function parseBacklog(filepath: string): BacklogEntry[];
//# sourceMappingURL=backlog-parser.d.ts.map