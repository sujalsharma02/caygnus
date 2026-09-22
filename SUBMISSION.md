# Product Engineering Challenge Submission

## Candidate

- **Name:** Sujal Sharma
- **Email:** sujalsharma1786@gmail.com
- **GitHub:** [sujalsharma02](https://github.com/sujalsharma02)
- **Selected problem:** Problem 4 — Trustworthy Long-Term Memory
- **Demo video:** <!-- TODO: fill before submitting -->

## Run the project

Prerequisite: **Node >= 24** — a hard requirement, because the database is `node:sqlite` (absent before 24) and TypeScript runs natively without a build step. `node --version` to check; `nvm install 24` if needed. No environment variables are required. Optional: `PORT` (default 3000), `MEMORY_DB` (default `./memory.db`, use `:memory:` for ephemeral).

```text
npm install
npm start
```

**Successful scenario:** POST two `home_city` facts where the second source text contains a correction word ("moved"). The response `rule` is `supersede`; `GET /recall?q=city` returns only the new one; `GET /memories/:id/history` shows the chain. Exact curl commands are in [README.md](README.md).

**Failure / recovery scenario (uncertain contradiction):** POST `favorite_cuisine=Italian` then `favorite_cuisine=Thai` with a source text that does *not* signal correction. The response `rule` is `conflict`: both stay active, each carries `conflicts_with`, and `/recall` marks them `lexical+vector+unresolved_conflict`. Resolve with `POST /memories/:thaiId/supersede/:italianId`. Nothing is destroyed until a user or caller decides.

## Run the tests

```text
npm test
```

11 tests via `node:test`, in-memory SQLite, injected monotonic clock, no network. They cover: storage + provenance + idempotent ids, bounded retrieval with evidence, explicit correction + chain history + "moved back", uncertain contradiction + manual resolution, multi-valued attributes, soft deletion, benchmark determinism (run twice), the HTTP layer, and the retrievers (vector finds a misspelling lexical cannot; hybrid is deterministic and keeps evidence).

## Acceptance scenarios and verification

| AC | Status | Where |
|---|---|---|
| AC1 store with provenance | done | `Engine.remember`, test "storage and provenance" |
| AC2 relevant retrieval | done | `retrieve.ts`, test "bounded relevant retrieval" |
| AC3 explicit correction | done | `reconcile.ts` → `supersede`, test "explicit correction" |
| AC4 uncertain contradiction | done | `reconcile.ts` → `conflict`, test "uncertain contradiction" |
| AC5 deletion | done (soft) | `Engine.delete`, test "deletion" |
| AC6 stable evaluation | done | `bench.ts`, test "stable evaluation" |

Benchmark:

```text
npm run bench
```

Observed result (this commit): **25/25 queries passed**, `memories: {"active":33,"superseded":7,"deleted":1}`. Fixture: 41 memories across 25 attributes, 6 supersession chains (one three links long), 2 unresolved conflicts, 1 deletion, 25 queries each with expected inclusions/exclusions. The bench also fails if any returned memory is not `active`.

## Architecture and data flow

```
HTTP (server.ts)  →  Engine (engine.ts)  →  Store (store.ts, SQLite)
                         │
                         ├─ reconcile.ts   pure: (candidate, active same-key memories) → rule
                         └─ retrieve.ts    Retriever interface: Lexical | Vector(Embedder) | Hybrid
                                 └─ embed.ts   Embedder interface + HashEmbedder (local, deterministic)
bench.ts / tests drive Engine directly with Store(":memory:") and an injected clock.
```

- **Store**: one table, lookup columns + JSON body. `put/get/list` only.
- **Engine**: the only place state transitions happen (`active → superseded | deleted`). Owns identity and the clock.
- **reconcile**: decides `new | duplicate | multi | supersede | conflict`. No I/O.
- **retrieve**: `Retriever` interface with three implementations. `LexicalRetriever` = fraction of stemmed query terms present. `VectorRetriever` = cosine over `Embedder` vectors with a floor. `HybridRetriever` = `0.6·lexical + 0.4·vector`, union of candidates, deterministic tie-break (score, recency, id). No I/O. The engine holds a `Retriever` and never sees embeddings.
- **embed**: `Embedder { embed(text): Promise<number[]> }`. Default `HashEmbedder`: feature-hashed char-trigrams of stemmed tokens, L2-normalised, 256 dims, no dependencies, bit-for-bit deterministic. A real model (transformers.js MiniLM) drops in behind the interface.
- **server**: validation and status codes only; also serves `public/index.html`, a single-file vanilla-JS console used in the demo (store / recall / list by state / history / delete / resolve conflict). Not a product UI.

## Technology choices

Node 24 + TypeScript with zero build step, `node:sqlite`, `node:test`; Express is the only runtime dependency. Alternatives considered: FastAPI (equally fine, switched on request), a neural embedding model as the default retriever (rejected for the submitted build: the brief demands determinism with no paid service, and a 90 MB model download in `npm install` hurts the 10-minute setup rule; the `Embedder` seam exists so it is a one-file swap). Trade-off accepted: `node:sqlite` is still flagged experimental; it prints a warning and would be swapped for `better-sqlite3` behind the same `Store` if that mattered.

## Important decisions

1. **Identity is per statement, not per value.** `id = sha1(source.message_id | subject | attribute | value)`. Re-sending the same message is idempotent; "moved back to Pune" is a *new* memory (new source) that supersedes Mumbai, giving a Pune → Mumbai → Pune chain with full history.
2. **Explicit vs uncertain is decided by the source text, not the value.** A candidate for a single-valued attribute with a different value is a correction only if the caller says `correction: true` or the source contains a correction cue (`moved, now, actually, no longer, changed, switched, …`). Otherwise both memories stay active and are cross-linked in `conflicts_with`; retrieval surfaces the conflict rather than picking a winner. Multi-valued attributes (`likes`, `language`, …) never conflict.
3. **Soft delete.** Deleted memories leave listing and retrieval but remain fetchable by id so a user can audit what was deleted, and so supersession chains that pass through a deleted node don't dangle. Hard purge is a one-line `DELETE` if a compliance requirement demands it.

## Assumptions and limitations

- Memories arrive as structured candidates (`attribute/value`); free-text extraction is out of scope per the brief. Attribute names are the vocabulary; two callers using `city` and `home_city` will not reconcile.
- Retrieval is hybrid lexical + hashed-trigram vector over `subject + attribute + value + source text`. The vector side catches misspellings and morphology, **not synonyms**: "Where do you reside" will not match "I live in Mumbai". True semantic recall needs a model behind `Embedder`.
- Hybrid weights (0.6/0.4) and the vector floor (0.3) are tuned on the fixture, not learned.
- The stemmer is deliberately crude (`moved`/`move` → `mov`); it must be consistent, not correct.
- Single user (`subject` defaults to `"user"`), no auth, single process.
- `MULTI_VALUED` is a hard-coded set; it would become per-attribute metadata with more than a handful of entries.

## Production and scale

*Now:* one SQLite file, full scan of active memories per query, in-process.
*First changes:* (1) `LexicalRetriever` → SQLite FTS5, `VectorRetriever` → precomputed vectors in a table (or sqlite-vec) instead of the in-process cache, `HashEmbedder` → a small local model; the `Retriever`/`Embedder` interfaces and the `Hit` evidence shape stay; (2) per-attribute schema (cardinality, sensitivity class) instead of the `MULTI_VALUED` set; (3) sensitive attributes (health, finances, identifiers) stored with a `sensitivity` flag, excluded from default recall, hard-deleted on request and never echoed in evidence; (4) an extraction stage in front of `remember` that emits candidates with a confidence, routing low-confidence ones to `conflict` instead of `supersede`; (5) `subject` becomes a tenant key with row-level scoping.

## AI usage

An AI coding assistant wrote the initial implementation, fixture and tests from the problem brief, under a "minimal viable" prompt. I reviewed every file, chose the stack (switched from FastAPI to TypeScript mid-way), fixed two failures the benchmark exposed in the tokenizer (`user's` → stray `s` token; `hobbies` not matching `hobby`), and rewrote fixture queries that were testing synonyms the lexical retriever cannot honour. All claims above were verified by running `npm test` and `npm run bench`.

## Credibility note

<!-- TODO: one shipped system, your contribution, scale, one hard decision, link. -->
