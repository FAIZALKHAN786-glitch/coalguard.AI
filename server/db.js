import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
export function openDatabase(filename) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,mines TEXT NOT NULL DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mines(id TEXT PRIMARY KEY,name TEXT NOT NULL,subsidiary TEXT NOT NULL,region TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,capacity REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,mine_id TEXT NOT NULL REFERENCES mines(id),title TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,priority TEXT NOT NULL,due_date TEXT,owner TEXT NOT NULL,notes TEXT NOT NULL,data TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS idx_records_kind_mine ON records(kind,mine_id);
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,mine_id TEXT NOT NULL REFERENCES mines(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,storage_name TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS embeddings(document_id TEXT PRIMARY KEY REFERENCES documents(id),model TEXT NOT NULL,vector TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,actor_name TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,mine_id TEXT,payload TEXT NOT NULL,created_at TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS read_notifications(user_id TEXT NOT NULL REFERENCES users(id),notification_id TEXT NOT NULL,PRIMARY KEY(user_id,notification_id));
 CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL,key TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(user_id,key));
 `);
  return db;
}
export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();
export function audit(db, user, action, entity, mineId, payload = {}) {
  const prev =
    db.prepare("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").get()?.hash ||
    "GENESIS";
  const entry = {
    actor: user.id,
    actor_name: user.name,
    action,
    entity,
    mine_id: mineId || null,
    payload: JSON.stringify(payload),
    created_at: now(),
    previous_hash: prev,
  };
  const hash = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  db.prepare(
    "INSERT INTO audit(actor,actor_name,action,entity,mine_id,payload,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(...Object.values(entry), hash);
}
export function verifyAudit(db) {
  let prev = "GENESIS";
  let count = 0;
  for (const row of db.prepare("SELECT * FROM audit ORDER BY id").all()) {
    const { id, hash, ...entry } = row;
    if (
      entry.previous_hash !== prev ||
      createHash("sha256").update(JSON.stringify(entry)).digest("hex") !== hash
    )
      return { valid: false, count, brokenAt: id };
    prev = hash;
    count++;
  }
  return { valid: true, count, head: prev };
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function record(row) {
  if (!row) return null;
  const {
    mine_id,
    due_date,
    created_at,
    updated_at,
    created_by,
    data,
    ...rest
  } = row;
  return {
    ...rest,
    mineId: mine_id,
    dueDate: due_date,
    createdAt: created_at,
    updatedAt: updated_at,
    createdBy: created_by,
    data: JSON.parse(data),
  };
}
