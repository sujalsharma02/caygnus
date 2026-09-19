# Trustworthy Long-Term Memory

Problem 4 of the [Caygnus product-engineer challenge](https://github.com/caygnus/product-engineer-ps). See [SUBMISSION.md](SUBMISSION.md) for design notes.

## Run

Requires Node >= 24 (native TypeScript, `node:sqlite`, `node:test`). No other runtime.

```bash
npm install
npm start            # http://localhost:3000 (demo console at /), data in ./memory.db  (MEMORY_DB=:memory: for ephemeral)
npm test             # 9 deterministic tests
npm run bench        # fixture benchmark, exit 1 on any mismatch
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/memories` | store a candidate `{attribute, value, source:{message_id,text}, subject?, correction?}` → `{memory, rule}` |
| GET | `/memories?state=active\|superseded\|deleted\|all` | list |
| GET | `/memories/:id` | inspect one (any state) |
| GET | `/memories/:id/history` | full supersession chain, oldest first |
| POST | `/memories/:newId/supersede/:oldId` | resolve a conflict / manual correction |
| DELETE | `/memories/:id` | soft delete |
| GET | `/recall?q=...&limit=5` | bounded retrieval with evidence |

## Walkthrough

```bash
curl -s localhost:3000/memories -H 'content-type: application/json' \
  -d '{"attribute":"home_city","value":"Pune","source":{"message_id":"m1","text":"I live in Pune"}}'
curl -s localhost:3000/memories -H 'content-type: application/json' \
  -d '{"attribute":"home_city","value":"Mumbai","source":{"message_id":"m2","text":"I moved to Mumbai"}}'
# → rule: "supersede"
curl -s 'localhost:3000/recall?q=which+city+does+the+user+live+in'     # only Mumbai
curl -s localhost:3000/memories/<pune-id>/history                       # Pune(superseded) → Mumbai(active)
curl -s -X DELETE localhost:3000/memories/<mumbai-id>
```
