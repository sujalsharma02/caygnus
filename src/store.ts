import { DatabaseSync } from "node:sqlite";
import type { Memory, State } from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  attribute TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at REAL NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_key ON memories(subject, attribute, state);
`;

/** SQLite persistence. Only lookup columns are real columns; the full Memory is JSON in `body`. */
export class Store {
  private db: DatabaseSync;

  constructor(path = "memory.db") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  put(m: Memory): Memory {
    this.db
      .prepare("INSERT OR REPLACE INTO memories VALUES (?,?,?,?,?,?)")
      .run(m.id, m.subject, m.attribute, m.state, m.created_at, JSON.stringify(m));
    return m;
  }

  get(id: string): Memory | undefined {
    const row = this.db.prepare("SELECT body FROM memories WHERE id=?").get(id) as { body: string } | undefined;
    return row && JSON.parse(row.body);
  }

  list(filter: { state?: State; subject?: string; attribute?: string } = {}): Memory[] {
    const where: string[] = [];
    const args: string[] = [];
    for (const [col, val] of Object.entries(filter)) {
      if (val !== undefined) {
        where.push(`${col}=?`);
        args.push(val);
      }
    }
    const sql =
      "SELECT body FROM memories" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY created_at, id";
    return (this.db.prepare(sql).all(...args) as { body: string }[]).map((r) => JSON.parse(r.body));
  }
}
