import type { Hit, Memory } from "./types.ts";

const STOP = new Set(
  "the a an is are do does did what where who which user i my me of to in on for and or it you your about tell know any have has be was were".split(" "),
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (let t of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (t.length < 2 || STOP.has(t)) continue;
    // ponytail: crude suffix stemmer. It only has to be *consistent* between query and
    // memory (moved/move -> "mov"), not linguistically right. Real stemmer if the fixture needs it.
    if (t.endsWith("ies")) t = t.slice(0, -3) + "y";
    else
      for (const suf of ["ing", "es", "ed", "s"]) {
        if (t.endsWith(suf) && t.length - suf.length >= 3) {
          t = t.slice(0, -suf.length);
          break;
        }
      }
    if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1);
    out.add(t);
  }
  return out;
}

/** Bounded, explainable, deterministic: score = query/memory term overlap. */
export function retrieve(query: string, memories: Memory[], limit = 5): Hit[] {
  const q = tokens(query);
  const hits: Hit[] = [];
  for (const m of memories) {
    const matched = [...tokens(m.text)].filter((t) => q.has(t)).sort();
    if (matched.length === 0) continue;
    hits.push({
      memory: m,
      score: matched.length,
      matched_terms: matched,
      rule: m.conflicts_with.length ? "term_overlap+unresolved_conflict" : "term_overlap",
    });
  }
  // score desc, newest first, then id: fully deterministic
  hits.sort(
    (a, b) =>
      b.score - a.score || b.memory.created_at - a.memory.created_at || a.memory.id.localeCompare(b.memory.id),
  );
  return hits.slice(0, limit);
}
