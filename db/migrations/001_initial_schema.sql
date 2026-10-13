-- CoalGuard AI schema migration v1: initial schema.
-- Target: PostgreSQL 15+. Compatible with the existing SQLite schema contract.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    mines JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subsidiary TEXT NOT NULL,
    region TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    capacity DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mine_id TEXT NOT NULL REFERENCES mines(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    due_date DATE,
    owner TEXT NOT NULL,
    notes TEXT NOT NULL,
    data JSONB NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

-- Query performance: the existing application filters by kind+mine,
-- by mine+created_at, and by mine+kind+created_at.
CREATE INDEX IF NOT EXISTS idx_records_kind_mine
    ON records(kind, mine_id);
CREATE INDEX IF NOT EXISTS idx_records_mine_created
    ON records(mine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_mine_kind_created
    ON records(mine_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    mine_id TEXT NOT NULL REFERENCES mines(id),
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_name TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_mine_created
    ON documents(mine_id, created_at DESC);

CREATE TABLE IF NOT EXISTS embeddings (
    document_id TEXT PRIMARY KEY REFERENCES documents(id),
    model TEXT NOT NULL,
    vector JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    mine_id TEXT,
    payload JSONB NOT NULL,
    created_at timestamptz NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_mine_id
    ON audit(mine_id, id DESC);

CREATE TABLE IF NOT EXISTS read_notifications (
    user_id TEXT NOT NULL REFERENCES users(id),
    notification_id TEXT NOT NULL,
    PRIMARY KEY(user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS idempotency (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    record_id TEXT NOT NULL,
    PRIMARY KEY(user_id, key)
);

-- Schema version tracking. This replaces SQLite's PRAGMA user_version.
CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
