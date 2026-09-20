/** Deterministic verification benchmark: `node bench.ts [fixture.json]`. Exit 1 on any mismatch. */
import { readFileSync } from "node:fs";
import { Engine } from "./src/engine.ts";
import { Store } from "./src/store.ts";
import type { Candidate } from "./src/types.ts";

interface Fixture {
  memories: (Candidate & { label: string })[];
  delete: string[];
  queries: { q: string; include: string[]; exclude: string[]; limit?: number }[];
}

export async function runBench(path: string, log = console.log): Promise<boolean> {
  let tick = 0;
  const engine = new Engine(new Store(":memory:"), () => ++tick); // injected clock: fully deterministic
  const fx: Fixture = JSON.parse(readFileSync(path, "utf8"));
  const ids = new Map<string, string>();
  for (const { label, ...c } of fx.memories) ids.set(label, engine.remember(c).memory.id);
  for (const label of fx.delete) engine.delete(ids.get(label)!);

  let pass = 0;
  for (const { q, include, exclude, limit } of fx.queries) {
    const hits = await engine.recall(q, limit ?? 5);
    const got = new Set(hits.map((h) => h.memory.id));
    const missing = include.filter((l) => !got.has(ids.get(l)!));
    const leaked = exclude.filter((l) => got.has(ids.get(l)!));
    const badState = hits.filter((h) => h.memory.state !== "active").map((h) => h.memory.id);
    const ok = !missing.length && !leaked.length && !badState.length;
    pass += ok ? 1 : 0;
    log(`${ok ? "PASS" : "FAIL"}  ${q}`);
    log(`      got: ${hits.map((h) => `${h.memory.attribute}=${h.memory.value} [${h.score}: ${h.matched_terms.join(",")}]`).join(" | ") || "-"}`);
    if (missing.length) log(`      missing: ${missing.join(", ")}`);
    if (leaked.length) log(`      leaked:  ${leaked.join(", ")}`);
    if (badState.length) log(`      non-active result: ${badState.join(", ")}`);
  }
  const byState = Object.fromEntries((["active", "superseded", "deleted"] as const).map((s) => [s, engine.list(s).length]));
  log(`\n${pass}/${fx.queries.length} queries passed. memories: ${JSON.stringify(byState)}`);
  return pass === fx.queries.length;
}

if (import.meta.main) process.exit((await runBench(process.argv[2] ?? "fixtures/fixture.json")) ? 0 : 1);
