import { cosine, type Embedder } from "./embed.ts";
import type { Hit, Memory } from "./types.ts";

export interface Retriever {
  /** `memories` is already lifecycle-filtered (active only) by the caller. */
  retrieve(query: string, memories: Memory[], limit: number): Promise<Hit[]>;
}

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

/** Deterministic ordering: score desc, newest first, then id. */
function rank(hits: Hit[], limit: number): Hit[] {
  return hits
    .sort((a, b) => b.score - a.score || b.memory.created_at - a.memory.created_at || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit);
}

/** score = fraction of query terms present in the memory text. */
export class LexicalRetriever implements Retriever {
  async retrieve(query: string, memories: Memory[], limit: number): Promise<Hit[]> {
    const q = tokens(query);
    const hits: Hit[] = [];
    for (const m of memories) {
      const matched = [...tokens(m.text)].filter((t) => q.has(t)).sort();
      if (matched.length === 0) continue;
      hits.push({ memory: m, score: matched.length / q.size, matched_terms: matched, rule: "lexical" });
    }
    return rank(hits, limit);
  }
}

/** score = cosine similarity between query and memory embeddings, below `floor` is dropped. */
export class VectorRetriever implements Retriever {
  private cache = new Map<string, number[]>(); // ponytail: in-process cache; a vector index at scale
  private embedder: Embedder;
  private floor: number;

  // ponytail: floor tuned on the fixture; retune when swapping the embedder
  constructor(embedder: Embedder, floor = 0.3) {
    this.embedder = embedder;
    this.floor = floor;
  }

  private async vec(key: string, text: string): Promise<number[]> {
    let v = this.cache.get(key);
    if (!v) this.cache.set(key, (v = await this.embedder.embed(text)));
    return v;
  }

  async retrieve(query: string, memories: Memory[], limit: number): Promise<Hit[]> {
    const q = await this.embedder.embed(query);
    const hits: Hit[] = [];
    for (const m of memories) {
      const sim = cosine(q, await this.vec(m.id, m.text));
      if (sim >= this.floor) hits.push({ memory: m, score: sim, matched_terms: [], rule: "vector" });
    }
    return rank(hits, limit);
  }
}

/** score = w·lexical + (1-w)·vector. A memory found by either side is a candidate. */
export class HybridRetriever implements Retriever {
  private lexical: Retriever;
  private vector: Retriever;
  private w: number;

  constructor(lexical: Retriever, vector: Retriever, w = 0.6) {
    this.lexical = lexical;
    this.vector = vector;
    this.w = w;
  }

  async retrieve(query: string, memories: Memory[], limit: number): Promise<Hit[]> {
    const [lex, vec] = await Promise.all([
      this.lexical.retrieve(query, memories, memories.length),
      this.vector.retrieve(query, memories, memories.length),
    ]);
    const byId = new Map<string, Hit>();
    for (const h of lex) byId.set(h.memory.id, { ...h, score: this.w * h.score, rule: "lexical" });
    for (const h of vec) {
      const prev = byId.get(h.memory.id);
      const semantic = (1 - this.w) * h.score;
      if (prev) byId.set(h.memory.id, { ...prev, score: prev.score + semantic, rule: "lexical+vector" });
      else byId.set(h.memory.id, { ...h, score: semantic, rule: "vector" });
    }
    const hits = [...byId.values()].map((h) => ({
      ...h,
      score: Math.round(h.score * 1000) / 1000,
      rule: h.memory.conflicts_with.length ? `${h.rule}+unresolved_conflict` : h.rule,
    }));
    return rank(hits, limit);
  }
}
