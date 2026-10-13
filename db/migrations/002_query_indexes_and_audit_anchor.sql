-- CoalGuard AI schema migration v2: query indexes, session hygiene index,
-- and audit anchor table.

-- Session cleanup / expiry queries.
CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON sessions(expires);

-- Audit anchor: anchored entry count and head hash. Without this, deleting the
-- newest audit rows leaves a self-consistent (but shorter) chain. The anchor
-- is initialised from the existing chain during migration so a legacy database
-- with audit entries starts anchored correctly.
CREATE TABLE IF NOT EXISTS audit_anchor (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    entries INTEGER NOT NULL,
    head TEXT NOT NULL
);
