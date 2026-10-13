import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Versioned migrations. Each entry runs once, in order, inside a transaction,
// and advances PRAGMA user_version. Migrations must never destroy user data:
// they only add tables, columns or indexes. A database created by an older
// release is upgraded in place without losing records.
const MIGRATIONS = [
  {
    version: 1,
    name: "initial_schema",
    sql: `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,mines TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mines(id TEXT PRIMARY KEY,name TEXT NOT NULL,subsidiary TEXT NOT NULL,region TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,capacity REAL NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,mine_id TEXT NOT NULL REFERENCES mines(id),title TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,priority TEXT NOT NULL,due_date TEXT,owner TEXT NOT NULL,notes TEXT NOT NULL,data TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_records_kind_mine ON records(kind,mine_id);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,mine_id TEXT NOT NULL REFERENCES mines(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,storage_name TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings(document_id TEXT PRIMARY KEY REFERENCES documents(id),model TEXT NOT NULL,vector TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,actor_name TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,mine_id TEXT,payload TEXT NOT NULL,created_at TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS read_notifications(user_id TEXT NOT NULL REFERENCES users(id),notification_id TEXT NOT NULL,PRIMARY KEY(user_id,notification_id));
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL,key TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(user_id,key));`,
  },
  {
    version: 2,
    name: "query_indexes_and_audit_anchor",
    sql: `CREATE INDEX IF NOT EXISTS idx_records_mine_created ON records(mine_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_mine_kind_created ON records(mine_id,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_mine_created ON documents(mine_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_mine_id ON audit(mine_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
-- Anchored audit length and head hash. Without this, deleting the newest
-- audit rows leaves a self-consistent (but shorter) chain. The anchor is
-- initialised from the existing chain in migrate() below so a legacy database
-- with audit entries starts anchored correctly.
CREATE TABLE IF NOT EXISTS audit_anchor(id INTEGER PRIMARY KEY CHECK(id=1),entries INTEGER NOT NULL,head TEXT NOT NULL);`,
  },
];

export const schemaVersion = () =>
  MIGRATIONS[MIGRATIONS.length - 1].version;


// Initialise the audit anchor from an existing chain when upgrading a legacy
// database. An empty audit table is anchored at (0, GENESIS); a verified chain
// is anchored at (count, last_hash). A chain that is already broken is left
// un-anchored so an operator can see it needs review rather than having an
// anchor silently invented. Does nothing if the anchor already exists.
function initialiseAuditAnchor(db) {
  if (db.prepare("SELECT id FROM audit_anchor WHERE id=1").get()) return;
  const count = db.prepare("SELECT COUNT(*) n FROM audit").get().n;
  if (count === 0) {
    db.prepare("INSERT INTO audit_anchor(id,entries,head) VALUES(1,0,'GENESIS')").run();
    return;
  }
  let prev = "GENESIS";
  const rows = db.prepare("SELECT id,hash,previous_hash FROM audit ORDER BY id").all();
  for (const row of rows) {
    if (row.previous_hash !== prev) return; // broken chain: do not anchor
    prev = row.hash;
  }
  db.prepare("INSERT INTO audit_anchor(id,entries,head) VALUES(1,?,?)").run(count, prev);
}
export function migrate(db) {
  const applied = db.prepare("PRAGMA user_version").get().user_version || 0;
  if (applied > schemaVersion())
    throw new Error(
      `Database schema version ${applied} is newer than this build (${schemaVersion()}). Upgrade the application or restore an older backup.`,
    );
  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version=${migration.version}`);
      if (migration.version === 2) initialiseAuditAnchor(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Database migration ${migration.version} (${migration.name}) failed: ${error.message}`,
      );
    }
  }
}

export function openDatabase(filename) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  migrate(db);
  return db;
}

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

// Insert an audit entry and advance the anchored head atomically. A SAVEPOINT
// nests correctly inside a caller's transaction and starts one when called
// standalone, so a mutation and its audit entry (and the anchor) always commit
// or roll back together.
export function audit(db, user, action, entity, mineId, payload = {}) {
  db.exec("SAVEPOINT coalguard_audit");
  try {
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
    // Advance the anchored head by one rather than counting the table, so an
    // audit write stays O(1) as the log grows. A row inserted into `audit`
    // outside this function therefore makes verification report a mismatch.
    const entries =
      (db.prepare("SELECT entries FROM audit_anchor WHERE id=1").get()?.entries ??
        0) + 1;
    db.prepare(
      "INSERT INTO audit_anchor(id,entries,head) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET entries=excluded.entries,head=excluded.head",
    ).run(entries, hash);
    db.exec("RELEASE coalguard_audit");
    return hash;
  } catch (error) {
    db.exec("ROLLBACK TO coalguard_audit");
    db.exec("RELEASE coalguard_audit");
    throw error;
  }
}

// Tamper-evidence, not immutability: the chain proves that no stored entry was
// altered, reordered or removed from the middle, and the anchor proves the log
// was not truncated at the end. An operator who can write to this database file
// could still rewrite the whole chain and the anchor together; only an external
// write-once anchor or signed export closes that gap.
export function verifyAudit(db) {
  let prev = "GENESIS";
  let count = 0;
  for (const row of db.prepare("SELECT * FROM audit ORDER BY id").all()) {
    const { id, hash, ...entry } = row;
    if (
      entry.previous_hash !== prev ||
      createHash("sha256").update(JSON.stringify(entry)).digest("hex") !== hash
    )
      return { valid: false, count, brokenAt: id, anchor: null };
    prev = hash;
    count++;
  }
  const anchor = db.prepare("SELECT * FROM audit_anchor WHERE id=1").get() || null;
  if (anchor && (anchor.entries !== count || anchor.head !== prev))
    return {
      valid: false,
      count,
      brokenAt: null,
      anchor: { entries: anchor.entries, head: anchor.head },
      reason:
        count < anchor.entries
          ? "The audit log is shorter than its anchored length; entries appear to have been removed."
          : "The audit log does not match its anchored head hash; entries appear to have been altered.",
    };
  return { valid: true, count, head: prev, anchor: anchor ? anchor.entries : null };
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
