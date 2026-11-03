// Sustituto de Cloudflare D1 para las pruebas: la misma API (prepare/bind/first/all/run/batch)
// sobre SQLite de Node (node:sqlite), con el esquema real de worker/migrations.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS = new URL("../../worker/migrations/", import.meta.url);

const value = v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
const plain = row => (row ? { ...row } : row);

class Statement {
  constructor(db, sql, binds = []) { this.db = db; this.sql = sql; this.binds = binds; }
  bind(...values) { return new Statement(this.db, this.sql, values.map(value)); }
  _returnsRows() { return /^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql); }
  _exec() {
    this.db.queries++;
    const stmt = this.db.sqlite.prepare(this.sql);
    if (this._returnsRows()) return { results: stmt.all(...this.binds).map(plain), meta: {} };
    const r = stmt.run(...this.binds);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first(col) {
    const { results } = this._exec();
    const row = results[0] ?? null;
    return col && row ? row[col] : row;
  }
  async all() { return { success: true, ...this._exec() }; }
  async run() { return { success: true, ...this._exec() }; }
}

export function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  const db = {
    sqlite,
    queries: 0,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      db.queries++;
      sqlite.exec("BEGIN");
      try {
        const out = statements.map(s => { db.queries--; return { success: true, ...s._exec() }; });
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql) { sqlite.exec(sql); }
  };
  return db;
}
