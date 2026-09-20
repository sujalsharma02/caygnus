import express, { type Request, type Response, type NextFunction } from "express";
import { Engine, Invalid, NotFound } from "./engine.ts";
import { Store } from "./store.ts";
import type { State } from "./types.ts";

export function createApp(engine: Engine) {
  const app = express();
  app.use(express.json());
  app.use(express.static("public")); // demo console at /

  app.post("/memories", (req, res) => {
    const { attribute, value, source } = req.body ?? {};
    if (typeof attribute !== "string" || typeof value !== "string" || !source?.message_id || !source?.text)
      return res.status(400).json({ error: "attribute, value, source.message_id, source.text are required" });
    res.status(201).json(engine.remember(req.body));
  });

  app.get("/memories", (req, res) => {
    const state = req.query.state as string | undefined;
    res.json(engine.list(state === "all" ? undefined : ((state ?? "active") as State)));
  });

  app.get("/memories/:id", (req, res) => {
    const m = engine.get(req.params.id);
    m ? res.json(m) : res.status(404).json({ error: "not found" });
  });

  app.get("/memories/:id/history", (req, res) => res.json(engine.history(req.params.id)));
  app.post("/memories/:newId/supersede/:oldId", (req, res) =>
    res.json(engine.supersede(req.params.newId, req.params.oldId)),
  );
  app.delete("/memories/:id", (req, res) => res.json(engine.delete(req.params.id)));

  app.get("/recall", async (req, res) => {
    const q = String(req.query.q ?? "");
    if (!q) return res.status(400).json({ error: "q is required" });
    res.json(await engine.recall(q, Number(req.query.limit ?? 5)));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const code = err instanceof NotFound ? 404 : err instanceof Invalid ? 409 : 500;
    res.status(code).json({ error: err.message });
  });
  return app;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  createApp(new Engine(new Store(process.env.MEMORY_DB ?? "memory.db"))).listen(port, () =>
    console.log(`memory service on http://localhost:${port}`),
  );
}
