import type { Candidate, Memory } from "./types.ts";

/** Source-message words that signal the user is explicitly replacing an earlier fact. */
const CORRECTION_RE =
  /\b(moved|now|actually|no longer|not anymore|changed|instead|correction|updated?|switched|new)\b/i;

// ponytail: attributes that hold many values at once and therefore never conflict.
// Everything else is single-valued. Promote to per-attribute metadata if this grows.
const MULTI_VALUED = new Set(["likes", "dislikes", "hobby", "language", "allergy", "pet"]);

export type Rule = "new" | "duplicate" | "multi" | "supersede" | "conflict";

export function isCorrection(c: Candidate): boolean {
  return c.correction ?? CORRECTION_RE.test(c.source.text);
}

/**
 * Decide how a candidate relates to the active memories sharing its (subject, attribute).
 *   new        - nothing active for this key
 *   duplicate  - same value already active (caller returns the existing memory)
 *   multi      - multi-valued attribute, coexist
 *   supersede  - explicit correction: old memories become superseded
 *   conflict   - uncertain contradiction: keep both active, link as conflicting
 */
export function decide(c: Candidate, current: Memory[]): { rule: Rule; related: Memory[] } {
  if (current.length === 0) return { rule: "new", related: [] };
  const same = current.filter((m) => m.value.toLowerCase() === c.value.toLowerCase());
  if (same.length) return { rule: "duplicate", related: same };
  if (MULTI_VALUED.has(c.attribute)) return { rule: "multi", related: [] };
  if (isCorrection(c)) return { rule: "supersede", related: current };
  return { rule: "conflict", related: current };
}
