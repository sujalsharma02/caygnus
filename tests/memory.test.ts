import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Engine, Invalid } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { createApp } from "../src/server.ts";
import { runBench } from "../bench.ts";
import { HashEmbedder } from "../src/embed.ts";
import { HybridRetriever, LexicalRetriever, VectorRetriever } from "../src/retrieve.ts";
import type { Memory } from "../src/types.ts";

const src = (id: string, text: string) => ({ message_id: id, text });
const fresh = () => {
  let t = 0;
  return new Engine(new Store(":memory:"), () => ++t);
};

describe("storage and provenance (AC1)", () => {
  it("stores with stable id and inspectable source", () => {
    const e = fresh();
    const c = { attribute: "home_city", value: "Pune", source: src("m1", "I live in Pune") };
    const { memory, rule } = e.remember(c);
    assert.equal(rule, "new");
    assert.equal(e.get(memory.id)?.source.text, "I live in Pune");
    // same fact from same message is idempotent
    assert.equal(fresh().remember(c).memory.id, memory.id);
    assert.equal(e.remember(c).rule, "duplicate");
    assert.equal(e.list("active").length, 1);
  });
});

describe("bounded relevant retrieval (AC2)", () => {
  it("returns only matching active memories with evidence, capped at limit", async () => {
    const e = fresh();
    e.remember({ attribute: "home_city", value: "Pune", source: src("m1", "I live in Pune") });
    e.remember({ attribute: "pet", value: "dog", source: src("m2", "I have a dog") });
    e.remember({ attribute: "likes", value: "jazz", source: src("m3", "I like jazz") });
    const hits = await e.recall("which city does the user live in", 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.memory.value, "Pune");
    assert.deepEqual(hits[0]!.matched_terms, ["city", "liv"]);
    assert.equal((await e.recall("quantum physics")).length, 0);
  });
});

describe("explicit correction (AC3)", () => {
  it("supersedes, links both ways, and excludes the old fact from retrieval", async () => {
    const e = fresh();
    const pune = e.remember({ attribute: "home_city", value: "Pune", source: src("m1", "I live in Pune") }).memory;
    const { memory: mumbai, rule } = e.remember({
      attribute: "home_city", value: "Mumbai", source: src("m2", "I moved to Mumbai"),
    });
    assert.equal(rule, "supersede");
    assert.equal(e.get(pune.id)?.state, "superseded");
    assert.equal(e.get(pune.id)?.superseded_by, mumbai.id);
    assert.equal(mumbai.supersedes, pune.id);
    assert.deepEqual(e.history(pune.id).map((m) => m.value), ["Pune", "Mumbai"]);
    assert.deepEqual((await e.recall("city")).map((h) => h.memory.value), ["Mumbai"]);
  });

  it("handles 'moved back' as a third link in the chain", () => {
    const e = fresh();
    e.remember({ attribute: "home_city", value: "Pune", source: src("m1", "I live in Pune") });
    e.remember({ attribute: "home_city", value: "Mumbai", source: src("m2", "I moved to Mumbai") });
    const back = e.remember({ attribute: "home_city", value: "Pune", source: src("m3", "I moved back to Pune") }).memory;
    assert.deepEqual(e.history(back.id).map((m) => `${m.value}:${m.state}`), [
      "Pune:superseded", "Mumbai:superseded", "Pune:active",
    ]);
  });
});

describe("uncertain contradiction (AC4)", () => {
  it("keeps both active, links the conflict, and allows manual resolution", async () => {
    const e = fresh();
    const italian = e.remember({ attribute: "favorite_cuisine", value: "Italian", source: src("m1", "Italian is my favorite cuisine") }).memory;
    const { memory: thai, rule } = e.remember({
      attribute: "favorite_cuisine", value: "Thai", source: src("m2", "Thai is my favorite cuisine"),
    });
    assert.equal(rule, "conflict");
    assert.equal(e.get(italian.id)?.state, "active");
    assert.deepEqual(e.get(italian.id)?.conflicts_with, [thai.id]);
    assert.deepEqual(thai.conflicts_with, [italian.id]);
    assert.ok((await e.recall("favorite cuisine")).every((h) => h.rule.includes("unresolved_conflict")));

    e.supersede(thai.id, italian.id);
    assert.equal(e.get(italian.id)?.state, "superseded");
    assert.deepEqual(e.get(thai.id)?.conflicts_with, []);
    assert.throws(() => e.supersede(thai.id, italian.id), Invalid);
  });

  it("multi-valued attributes never conflict", () => {
    const e = fresh();
    e.remember({ attribute: "likes", value: "coffee", source: src("m1", "I like coffee") });
    assert.equal(e.remember({ attribute: "likes", value: "tea", source: src("m2", "I like tea") }).rule, "multi");
    assert.equal(e.list("active").length, 2);
  });
});

describe("deletion (AC5)", () => {
  it("soft-deletes: gone from retrieval, still inspectable", async () => {
    const e = fresh();
    const m = e.remember({ attribute: "gym", value: "Cult.fit", source: src("m1", "my gym is Cult.fit") }).memory;
    e.delete(m.id);
    assert.equal((await e.recall("gym")).length, 0);
    assert.equal(e.get(m.id)?.state, "deleted");
    assert.equal(e.list("active").length, 0);
  });
});

describe("stable evaluation (AC6)", () => {
  it("fixture benchmark passes and is repeatable", async () => {
    const quiet = () => {};
    assert.equal(await runBench("fixtures/fixture.json", quiet), true);
    assert.equal(await runBench("fixtures/fixture.json", quiet), true);
  });
});

describe("http api", () => {
  it("round-trips a correction over HTTP", async () => {
    const server = createApp(fresh()).listen(0);
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const post = (body: unknown) =>
      fetch(`${base}/memories`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const a = await (await post({ attribute: "home_city", value: "Pune", source: src("m1", "I live in Pune") })).json();
      const b = await (await post({ attribute: "home_city", value: "Mumbai", source: src("m2", "I moved to Mumbai") })).json();
      assert.equal(b.rule, "supersede");
      const recall = await (await fetch(`${base}/recall?q=city`)).json();
      assert.deepEqual(recall.map((h: { memory: { value: string } }) => h.memory.value), ["Mumbai"]);
      const hist = await (await fetch(`${base}/memories/${a.memory.id}/history`)).json();
      assert.equal(hist.length, 2);
      assert.equal((await post({ attribute: "x" })).status, 400);
      assert.equal((await fetch(`${base}/memories/nope`)).status, 404);
    } finally {
      server.close();
    }
  });
});

describe("retrievers", () => {
  const mem = (id: string, text: string): Memory =>
    ({ id, subject: "user", attribute: "x", value: "", text, source: src(id, text), state: "active", created_at: 1, updated_at: 1, conflicts_with: [] });
  const docs = [mem("a", "user favorite cuisine Italian"), mem("b", "user pet dog Bruno"), mem("c", "user timezone Asia/Kolkata")];

  it("vector retriever finds near-spellings the lexical one cannot", async () => {
    const v = new VectorRetriever(new HashEmbedder());
    const l = new LexicalRetriever();
    assert.equal((await l.retrieve("Italien", docs, 5)).length, 0);
    assert.equal((await v.retrieve("Italien", docs, 5))[0]?.memory.id, "a");
  });

  it("hybrid combines both signals, keeps evidence, and is deterministic", async () => {
    const h = new HybridRetriever(new LexicalRetriever(), new VectorRetriever(new HashEmbedder()));
    const r1 = await h.retrieve("what is the favorite cuisine", docs, 5);
    const r2 = await h.retrieve("what is the favorite cuisine", docs, 5);
    assert.deepEqual(r1, r2);
    assert.equal(r1[0]?.memory.id, "a");
    assert.equal(r1[0]?.rule, "lexical+vector");
    assert.deepEqual(r1[0]?.matched_terms, ["cuisin", "favorit"]);
  });
});
