import { tokens } from "./retrieve.ts";

/** Anything that maps text to a fixed-length vector. Swap in a real model (e.g. transformers.js
 *  all-MiniLM) behind this interface; the engine and retrievers never see what is behind it. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/**
 * Zero-dependency, deterministic local embedder: feature-hashed character trigrams of stemmed
 * tokens, L2-normalised. Captures morphology and spelling proximity (cycling ~ cyclist,
 * vegetarian ~ vegetarians), not synonymy.
 * ponytail: real semantics needs a model; this keeps the benchmark deterministic and offline.
 */
export class HashEmbedder implements Embedder {
  private dim: number;
  constructor(dim = 256) {
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0);
    for (const t of tokens(text)) {
      const padded = ` ${t} `;
      for (let i = 0; i + 3 <= padded.length; i++) v[fnv1a(padded.slice(i, i + 3)) % this.dim]!++;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s; // inputs are unit vectors
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
