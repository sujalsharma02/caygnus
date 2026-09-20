import { createHash } from "node:crypto";
import { decide, type Rule } from "./reconcile.ts";
import { HashEmbedder } from "./embed.ts";
import { HybridRetriever, LexicalRetriever, VectorRetriever, type Retriever } from "./retrieve.ts";
import type { Store } from "./store.ts";
import type { Candidate, Hit, Memory } from "./types.ts";

/** Stable identity: the same fact from the same source message always gets the same id. */
export function memoryId(c: Candidate & { subject: string }): string {
  const key = `${c.source.message_id}|${c.subject}|${c.attribute}|${c.value.toLowerCase()}`;
  return "mem_" + createHash("sha1").update(key).digest("hex").slice(0, 12);
}

export class NotFound extends Error {}
export class Invalid extends Error {}

export class Engine {
  private store: Store;
  private clock: () => number;
  private retriever: Retriever;

  constructor(
    store: Store,
    clock: () => number = Date.now,
    retriever: Retriever = new HybridRetriever(new LexicalRetriever(), new VectorRetriever(new HashEmbedder())),
  ) {
    this.store = store;
    this.clock = clock;
    this.retriever = retriever;
  }

  /** Store a candidate, reconciling it against active memories with the same key. */
  remember(input: Candidate): { memory: Memory; rule: Rule } {
    const c = { subject: "user", ...input };
    const current = this.store.list({ state: "active", subject: c.subject, attribute: c.attribute });
    const { rule, related } = decide(c, current);
    if (rule === "duplicate") return { memory: related[0]!, rule };

    const now = this.clock();
    const m: Memory = {
      id: memoryId(c),
      subject: c.subject,
      attribute: c.attribute,
      value: c.value,
      text: `${c.subject} ${c.attribute.replaceAll("_", " ")} ${c.value}. ${c.source.text}`,
      source: c.source,
      state: "active",
      created_at: now,
      updated_at: now,
      conflicts_with: [],
    };
    if (rule === "supersede") {
      for (const old of related) this.link(old, m, now);
    } else if (rule === "conflict") {
      m.conflicts_with = related.map((o) => o.id);
      for (const old of related) {
        old.conflicts_with = [...new Set([...old.conflicts_with, m.id])].sort();
        old.updated_at = now;
        this.store.put(old);
      }
    }
    return { memory: this.store.put(m), rule };
  }

  /** Manual conflict resolution / explicit correction: `newId` replaces `oldId`. */
  supersede(newId: string, oldId: string): Memory {
    const [n, o] = [this.must(newId), this.must(oldId)];
    if (n.state !== "active" || o.state !== "active") throw new Invalid("both memories must be active");
    const now = this.clock();
    this.link(o, n, now);
    n.updated_at = now;
    return this.store.put(n);
  }

  /** Soft delete: excluded from retrieval and listing, still inspectable by id. */
  delete(id: string): Memory {
    const m = this.must(id);
    m.state = "deleted";
    m.updated_at = this.clock();
    return this.store.put(m);
  }

  get(id: string): Memory | undefined {
    return this.store.get(id);
  }

  /** The full supersession chain containing `id`, oldest first. */
  history(id: string): Memory[] {
    let m = this.must(id);
    while (m.supersedes) m = this.must(m.supersedes);
    const chain = [m];
    while (m.superseded_by) chain.push((m = this.must(m.superseded_by)));
    return chain;
  }

  /** Lifecycle filter (active only) happens here; the retriever never sees superseded/deleted rows. */
  recall(query: string, limit = 5): Promise<Hit[]> {
    return this.retriever.retrieve(query, this.store.list({ state: "active" }), limit);
  }

  list(state?: Memory["state"]): Memory[] {
    return this.store.list({ state });
  }

  private link(old: Memory, neu: Memory, now: number) {
    old.state = "superseded";
    old.superseded_by = neu.id;
    old.updated_at = now;
    old.conflicts_with = old.conflicts_with.filter((x) => x !== neu.id);
    neu.supersedes = old.id;
    neu.conflicts_with = neu.conflicts_with.filter((x) => x !== old.id);
    this.store.put(old);
  }

  private must(id: string): Memory {
    const m = this.store.get(id);
    if (!m) throw new NotFound(`memory ${id} not found`);
    return m;
  }
}
