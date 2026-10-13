import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, audit, transaction, now, verifyAudit } from "../server/db.js";
import { createApp } from "../server/app.js";

// Schema created by the first CoalGuard release (no PRAGMA user_version, no
// anchor table, no list indexes). Used to prove that an existing pilot database
// upgrades in place without losing rows.
const LEGACY_SCHEMA = `
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
`;

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-migrate-"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function legacyDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
    "u-admin",
    "Legacy Administrator",
    "admin@coalguard.demo",
    "$2b$12$legacyhashlegacyhashlegacyhashlegacyhashlegacyhashlegacyhash",
    "admin",
    "[]",
  );
  db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run(
    "gevra",
    "Gevra Open Cast",
    "SECL",
    "Korba",
    22.344,
    82.564,
    70,
  );
  const insert = db.prepare(
    "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 5; i++)
    insert.run(
      `legacy-${i}`,
      "compliance",
      "gevra",
      `Legacy obligation ${i}`,
      "Safety",
      "pending",
      "high",
      "2026-01-01",
      "Legacy Owner",
      "Evidence preserved across upgrade",
      "{}",
      "u-admin",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      1,
    );
  db.close();
  return file;
}

function indexNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => row.name);
}


function legacyDatabaseWithAudit(file, auditCount, recordCount) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
    "u-admin",
    "Legacy Administrator",
    "admin@coalguard.demo",
    "$2b$12$legacyhashlegacyhashlegacyhashlegacyhashlegacyhashlegacyhash",
    "admin",
    "[]",
  );
  db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run(
    "gevra",
    "Gevra Open Cast",
    "SECL",
    "Korba",
    22.344,
    82.564,
    70,
  );
  if (recordCount) {
    const insert = db.prepare(
      "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let i = 0; i < recordCount; i++)
      insert.run(
        `legacy-rec-${i}`,
        "compliance",
        "gevra",
        `Legacy obligation ${i}`,
        "Safety",
        "pending",
        "high",
        "2026-01-01",
        "Legacy Owner",
        "Evidence preserved across upgrade",
        "{}",
        "u-admin",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        1,
      );
  }
  if (auditCount) {
    let prev = "GENESIS";
    const nowStr = "2026-01-01T00:00:00.000Z";
    const ins = db.prepare(
      "INSERT INTO audit(actor,actor_name,action,entity,mine_id,payload,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    for (let i = 0; i < auditCount; i++) {
      const entry = {
        actor: "u-admin",
        actor_name: "Legacy Administrator",
        action: "checked",
        entity: "mine",
        mine_id: "gevra",
        payload: "{}",
        created_at: nowStr,
        previous_hash: prev,
      };
      const hash = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
      ins.run(
        entry.actor,
        entry.actor_name,
        entry.action,
        entry.entity,
        entry.mine_id,
        entry.payload,
        entry.created_at,
        entry.previous_hash,
        hash,
      );
      prev = hash;
    }
  }
  db.close();
  return file;
}

test("a pilot database from the previous release upgrades in place", () => {
  const file = path.join(dir, "legacy.sqlite");
  legacyDatabase(file);
  const before = new DatabaseSync(file);
  assert.equal(before.prepare("PRAGMA user_version").get().user_version, 0);
  const legacyRows = before
    .prepare("SELECT title FROM records ORDER BY id")
    .all()
    .map((r) => r.title);
  before.close();

  const db = openDatabase(file);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    assert.deepEqual(
      db
        .prepare("SELECT title FROM records ORDER BY id")
        .all()
        .map((r) => r.title),
      legacyRows,
      "no record may be lost or rewritten by a migration",
    );
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 1);
    assert.equal(
      db.prepare("SELECT notes FROM records WHERE id='legacy-3'").get().notes,
      "Evidence preserved across upgrade",
    );
    for (const index of [
      "idx_records_mine_created",
      "idx_records_mine_kind_created",
      "idx_documents_mine_created",
      "idx_audit_mine_id",
      "idx_sessions_expires",
    ])
      assert.ok(indexNames(db).includes(index), `missing ${index}`);
    assert.ok(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .some((row) => row.name === "audit_anchor"),
    );
    // An upgraded database is usable immediately: audit writes now maintain the
    // anchor and the chain still verifies.
    audit(db, { id: "u-admin", name: "Legacy Administrator" }, "checked", "upgrade", "gevra");
    const anchor = db.prepare("SELECT * FROM audit_anchor WHERE id=1").get();
    assert.equal(anchor.entries, 1);
  } finally {
    db.close();
  }
});

test("the application boots on an upgraded legacy database twice without side effects", async () => {
  const file = path.join(dir, "legacy-boot.sqlite");
  legacyDatabase(file);
  for (let pass = 0; pass < 2; pass++) {
    const instance = await createApp({
      database: file,
      demo: true,
      uploads: path.join(dir, `legacy-uploads-${pass}`),
    });
    try {
      assert.equal(instance.db.prepare("SELECT count(*) n FROM records").get().n >= 5, true);
    } finally {
      instance.db.close();
    }
  }
  const db = openDatabase(file);
  try {
    // Re-running the demo seed must not duplicate operator data.
    const titles = db
      .prepare("SELECT title FROM records WHERE id LIKE 'legacy-%'")
      .all();
    assert.equal(titles.length, 5);
  } finally {
    db.close();
  }
});

test("a database written by a newer release is refused instead of corrupted", () => {
  const file = path.join(dir, "future.sqlite");
  const db = new DatabaseSync(file);
  db.exec(LEGACY_SCHEMA);
  db.exec("PRAGMA user_version=99");
  db.close();
  assert.throws(() => openDatabase(file), /newer than this build/);
});

test("an up-to-date database reopens idempotently", () => {
  const file = path.join(dir, "repeat.sqlite");
  const first = openDatabase(file);
  audit(first, { id: "u-admin", name: "A" }, "one", "space", null);
  first.close();
  const second = openDatabase(file);
  try {
    assert.equal(second.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(second.prepare("SELECT count(*) n FROM audit").get().n, 1);
    assert.equal(second.prepare("SELECT entries FROM audit_anchor WHERE id=1").get().entries, 1);
  } finally {
    second.close();
  }
});

test("migration initialises the audit anchor from an existing verified chain", () => {
  // Reproduce the reported defect: a legacy database that already contains audit
  // entries must upgrade so that the anchor reflects the existing chain, not a
  // fresh (0, GENESIS) start. Otherwise the first new audit() would reset the
  // count to 1 and verification would fail.
  const file = path.join(dir, "legacy-with-audit.sqlite");
  legacyDatabaseWithAudit(file, 5, 3);
  const legacy = new DatabaseSync(file);
  assert.equal(legacy.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(legacy.prepare("SELECT count(*) n FROM audit").get().n, 5);
  legacy.close();

  const db = openDatabase(file);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    // All legacy audit rows must survive the migration unchanged.
    assert.equal(db.prepare("SELECT count(*) n FROM audit").get().n, 5);
    assert.equal(db.prepare("SELECT count(*) n FROM records").get().n, 3);
    // The anchor must reflect the existing chain head and length.
    const anchor = db.prepare("SELECT * FROM audit_anchor WHERE id=1").get();
    assert.ok(anchor, "an anchor row must exist after migration");
    assert.equal(anchor.entries, 5, "anchor entries must equal existing audit count");
    const lastHash = db.prepare("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").get().hash;
    assert.equal(anchor.head, lastHash, "anchor head must equal the last audit hash");
    // Verification must pass immediately after migration.
    assert.equal(verifyAudit(db).valid, true, "chain must verify immediately after migration");
  } finally {
    db.close();
  }
});

test("an upgraded database with existing audit entries accepts new audit writes and verifies", () => {
  const file = path.join(dir, "legacy-with-audit-append.sqlite");
  legacyDatabaseWithAudit(file, 5, 3);
  const db = openDatabase(file);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM audit").get().n, 5);
    const anchor = db.prepare("SELECT * FROM audit_anchor WHERE id=1").get();
    assert.equal(anchor.entries, 5);

    // Append a new audit entry and verify the chain.
    audit(db, { id: "u-admin", name: "Legacy Administrator" }, "checked", "mine", "gevra");
    assert.equal(db.prepare("SELECT count(*) n FROM audit").get().n, 6);
    const anchor2 = db.prepare("SELECT * FROM audit_anchor WHERE id=1").get();
    assert.equal(anchor2.entries, 6);
    const v = verifyAudit(db);
    assert.equal(v.valid, true, "chain must verify after migration + append");
    assert.equal(v.count, 6);
    assert.equal(v.anchor, 6);
  } finally {
    db.close();
  }
});

test("migration leaves no anchor when the legacy audit chain is broken", () => {
  // A broken legacy chain must not be silently "fixed" by inventing an anchor:
  // the absence of an anchor signals to an operator that the chain needs review.
  const file = path.join(dir, "legacy-broken.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
    "u-admin", "Admin", "admin@coalguard.demo", "$2b$12$legacyhashlegacyhashlegacyhashlegacyhashlegacyhashlegacyhash", "admin", "[]",
  );
  db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run("gevra", "Gevra", "SECL", "Korba", 22.344, 82.564, 70);
  // First entry is valid.
  const ins = db.prepare("INSERT INTO audit(actor,actor_name,action,entity,mine_id,payload,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)");
  const firstEntry = { actor: "u-admin", actor_name: "Admin", action: "checked", entity: "mine", mine_id: "gevra", payload: "{}", created_at: "2026-01-01T00:00:00.000Z", previous_hash: "GENESIS" };
  ins.run("u-admin", "Admin", "checked", "mine", "gevra", "{}", "2026-01-01T00:00:00.000Z", "GENESIS", createHash("sha256").update(JSON.stringify(firstEntry)).digest("hex"));
  // Second entry has a tampered previous_hash.
  ins.run("u-admin", "Admin", "checked", "mine", "gevra", "{}", "2026-01-01T00:00:01.000Z", "tampered", "badhash");
  db.close();

  const migrated = openDatabase(file);
  try {
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(migrated.prepare("SELECT count(*) n FROM audit").get().n, 2);
    const anchor = migrated.prepare("SELECT * FROM audit_anchor WHERE id=1").get();
    assert.equal(anchor, undefined, "a broken legacy chain must leave no anchor");
    assert.equal(verifyAudit(migrated).valid, false, "verified broken chain must be invalid");
  } finally {
    migrated.close();
  }
});

test("backup and restore returns both database rows and private uploads", async () => {
  const uploads = path.join(dir, "live-uploads");
  const database = path.join(dir, "live.sqlite");
  const instance = await createApp({ database, demo: true, uploads });
  const body = Buffer.from("Backup round-trip evidence: haul road drainage.");
  try {
    const { app, db } = instance;
    const request = (await import("supertest")).default;
    const admin = request.agent(app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    const doc = (
      await admin
        .post("/api/documents")
        .field("mineId", "gevra")
        .attach("file", body, "backup-evidence.txt")
        .expect(201)
    ).body;
    const recordCount = db.prepare("SELECT count(*) n FROM records").get().n;
    const auditCount = db.prepare("SELECT count(*) n FROM audit").get().n;

    // Operator procedure: consistent SQLite snapshot plus a copy of the
    // private upload directory.
    const snapshot = path.join(dir, "backup.sqlite");
    db.prepare("VACUUM INTO ?").run(snapshot);
    const restoredUploads = path.join(dir, "restored-uploads");
    fs.cpSync(uploads, restoredUploads, { recursive: true });

    const restored = await createApp({
      database: snapshot,
      demo: true,
      uploads: restoredUploads,
    });
    try {
      assert.equal(
        restored.db.prepare("SELECT count(*) n FROM records").get().n,
        recordCount,
      );
      assert.equal(
        restored.db.prepare("SELECT count(*) n FROM audit").get().n,
        auditCount,
      );
      const restoredAdmin = request.agent(restored.app);
      await restoredAdmin.post("/api/auth/demo").send({}).expect(200);
      const download = await restoredAdmin
        .get(`/api/documents/${doc.id}/download`)
        .expect(200);
      assert.equal(
        createHash("sha256").update(download.text).digest("hex"),
        createHash("sha256").update(body.toString("utf8")).digest("hex"),
        "restored upload must match the original bytes",
      );
      assert.equal(
        (await restoredAdmin.get("/api/audit/verify").expect(200)).body.valid,
        true,
        "a restored copy keeps a verifiable audit chain",
      );
    } finally {
      restored.db.close();
    }
  } finally {
    instance.db.close();
  }
});
