// Unified database adapter for CoalGuard AI.
//
// Provides a single async database interface that works with either SQLite
// (node:sqlite, the existing backend) or PostgreSQL (pg driver, the new
// backend). Application code uses the same await-based API regardless of
// which backend is active.
//
// Selection:
//   - If DATABASE_URL is set, the PostgreSQL backend is used.
//   - Otherwise the SQLite backend is used (existing behaviour).
//
// API:
//   db.prepare(sql).get(...params)  -> Promise<row | null>
//   db.prepare(sql).all(...params)  -> Promise<row[]>
//   db.prepare(sql).run(...params)  -> Promise<{ rowsAffected, lastInsertRowid }>
//   db.exec(sql)                    -> Promise<void>   (multi-statement for SQLite; single for PG)
//   db.transaction(async (tx) => { ... }) -> Promise<T>
//   db.close()                      -> Promise<void>
//   db.ready()                      -> Promise<schemaVersion>
//
// For PostgreSQL, tx.prepare(sql).get/all/run also return promises, and
// tx is a pg Client whose methods the transaction callback can use directly.
//
// Imports that used to come from db.js are re-exported here so existing
// import paths keep working:
//   import { openDatabase, audit, verifyAudit, transaction, record, uuid, now,
//            schemaVersion } from "./db.js";
// becomes:
//   import { openDatabase, audit, verifyAudit, transaction, record, uuid, now,
//            schemaVersion } from "./db-adapter.js";
//
// The shape of audit/verifyAudit results, record() output, uuid() and now()
// are identical between backends.

import { DatabaseSync } from "node:sqlite";
import {
  migrate as pgMigrate,
  audit as pgAudit,
  verifyAudit as pgVerifyAudit,
  transaction as pgTransaction,
  record as pgRecord,
  uuid,
  now,
} from "./db-pg.js";
import path from "node:path";

// Import SQLite-specific functions lazily to avoid circular dependencies
const sqliteModulePromise = import("./db.js");
function loadSqliteFunctions() {
  return sqliteModulePromise.then(dbModule => ({
    migrate: dbModule.migrate,
    audit: dbModule.audit,
    verifyAudit: dbModule.verifyAudit,
    transaction: dbModule.transaction,
    record: dbModule.record,
    schemaVersion: dbModule.schemaVersion,
  }));
}

// SQLite migrations are defined in db.js and applied through the adapter layer

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

export const USING_POSTGRESQL =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL.length > 0;

// ---------------------------------------------------------------------------
// SQLite backend (wrapped as async)
// ---------------------------------------------------------------------------

function sqlitePrepareWrapper(db) {
  const stmt = db.prepare.bind(db);
  return {
    get(...params) {
      return Promise.resolve(stmt(...params));
    },
    all(...params) {
      return Promise.resolve(stmt.all(...params));
    },
    run(...params) {
      return Promise.resolve(stmt.run(...params));
    },
  };
}async function createSqliteDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  const dbModule = await sqliteModulePromise;
  dbModule.migrate(db);
  
  

  return {
    _backend: "sqlite",
    _db: db,

    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        get(...params) {
          return Promise.resolve(stmt.get(...params));
        },
        all(...params) {
          return Promise.resolve(stmt.all(...params));
        },
        run(...params) {
          return Promise.resolve(stmt.run(...params));
        },
      };
    },

    exec(sql) {
      db.exec(sql);
      return Promise.resolve();
    },

    async transaction(fn) {
      // Provide a transaction-scoped interface that mirrors the top-level db.
      const tx = {
        prepare(sql) {
          const stmt = db.prepare(sql);
          return {
            get(...params) {
              return Promise.resolve(stmt.get(...params));
            },
            all(...params) {
              return Promise.resolve(stmt.all(...params));
            },
            run(...params) {
              return Promise.resolve(stmt.run(...params));
            },
          };
        },
        exec(sql) {
          db.exec(sql);
          return Promise.resolve();
        },
      };
      const result = await fn(tx);
      return result;
    },

    close() {
      db.close();
      return Promise.resolve();
    },

    ready() {
      const v = db.prepare("PRAGMA user_version").get();
      return Promise.resolve(v?.user_version || 0);
    },

    audit: sqliteAudit.bind(null, db),
    verifyAudit: () => sqliteVerifyAudit(db),
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL backend
// ---------------------------------------------------------------------------

function createPgDb(pool) {
  return {
    _backend: "postgresql",
    _pool: pool,

    prepare(sql) {
      return {
        get(...params) {
          return pool.query(sql, params).then((r) => r.rows[0] || null);
        },
        all(...params) {
          return pool.query(sql, params).then((r) => r.rows);
        },
        async run(...params) {
          const r = await pool.query(sql, params);
          return { rowsAffected: r.rowCount, lastInsertRowid: null };
        },
      };
    },

    exec(sql) {
      return pool.query(sql);
    },

    async transaction(fn) {
      const client = await pool.connect();
      let reusable = true;
      try {
        await client.query("BEGIN");
        const tx = {
          prepare(sql) {
            return {
              get(...params) {
                return client.query(sql, params).then((r) => r.rows[0] || null);
              },
              all(...params) {
                return client.query(sql, params).then((r) => r.rows);
              },
              async run(...params) {
                const r = await client.query(sql, params);
                return { rowsAffected: r.rowCount, lastInsertRowid: null };
              },
            };
          },
          exec(sql) {
            return client.query(sql);
          },
          async query(sql, params) {
            return client.query(sql, params);
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          reusable = false;
          console.error("PG transaction rollback failed:", rollbackErr.message);
        }
        throw err;
      } finally {
        client.release(!reusable);
      }
    },

    async close() {
      await pool.end();
    },

    async ready() {
      const v = await pool.query(
        "SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1",
      );
      return v.rows[0]?.version || 0;
    },

    audit: pgAudit.bind(null, pool),
    verifyAudit: () => pgVerifyAudit(pool),
  };
}

// ---------------------------------------------------------------------------
// openDatabase: create the right backend and run migrations
// ---------------------------------------------------------------------------

export async function openDatabase(filename) {
  if (USING_POSTGRESQL) {
    // PostgreSQL: the pool is created lazily inside db-pg.js on first use.
    const { getPool, resetPoolForTesting } = await import("./db-pg.js");
    const pool = getPool();
    // Run migrations asynchronously. If migration fails, the process should
    // not start serving requests.
    await pgMigrate(pool).then(
      () => console.info("[coalguard] PostgreSQL migration complete"),
      (err) => {
        console.error("[coalguard] PostgreSQL migration failed:", err.message);
        process.exitCode = 1;
      },
    );
    return createPgDb(pool);
  }

  // SQLite: resolve the filename and open.
  const resolved =
    filename === ":memory:"
      ? ":memory:"
      : path.resolve(
          path.dirname(filename || "./data/coalguard.sqlite"),
          filename || "./data/coalguard.sqlite",
        );
  return await createSqliteDb(resolved);
}

// ---------------------------------------------------------------------------
// Re-exports for import compatibility
// ---------------------------------------------------------------------------

export { uuid, now } from "./db-pg.js";

export const schemaVersion = () => {
  // Delegates to db.js for the SQLite schema version
  return import("./db.js").then(m => m.schemaVersion());
};

export const audit = async (db, user, action, entity, mineId, payload = {}) => {
  if (db._backend === "postgresql") {
    return pgAudit(db._pool, user, action, entity, mineId, payload);
  }
  const { audit: sqliteAuditFn } = await sqliteModulePromise;
  return Promise.resolve(sqliteAuditFn(db._db, user, action, entity, mineId, payload));
};

export const verifyAudit = async (db) => {
  if (db._backend === "postgresql") {
    return pgVerifyAudit(db._pool);
  }
  const { verifyAudit: sqliteVerifyAuditFn } = await sqliteModulePromise;
  return Promise.resolve(sqliteVerifyAuditFn(db._db));
};

export const transaction = async (db, fn) => db.transaction(fn);

export function record(row) {
  // pgRecord already handles both string and object data; sqliteRecord parses
  // JSON strings. For the SQLite backend we use the existing helper; for PG
  // the backend returns JSONB as objects. We normalise in one place.
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
    data:
      typeof data === "string" ? JSON.parse(data) : data,
  };
}

export { closeDatabase } from "./db-pg.js";
