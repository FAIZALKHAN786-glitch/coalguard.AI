// Synthetic load and concurrency measurement. Never point this at real data:
// it creates its own database, upload directory and temporary workdir.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { createApp } from "../server/app.js";

const RECORDS = Number(process.env.LOAD_RECORDS || 50000);
const ITERATIONS = Number(process.env.LOAD_ITERATIONS || 200);
const KINDS = [
  "compliance",
  "inspection",
  "action",
  "contractor",
  "operation",
  "environment",
  "attendance",
  "grievance",
  "field",
];

// Provisional targets, defined before measuring. They are engineering goals for
// a single-node pilot, not contractual service levels.
const TARGETS = {
  "GET /api/records/compliance": { p95: 300 },
  "GET /api/dashboard": { p95: 2500 },
  "GET /api/notifications": { p95: 2500 },
  "GET /api/audit": { p95: 300 },
  "GET /api/reports/csv": { p95: 3000 },
  "POST /api/records/action": { p95: 300 },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-load-"));
const database = path.join(dir, "load.sqlite");
const { app, db } = await createApp({ database, demo: true, uploads: path.join(dir, "uploads") });

// ---- synthetic dataset -----------------------------------------------------
const mines = db.prepare("SELECT id FROM mines").all().map((m) => m.id);
const insert = db.prepare(
  "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
);
const started = performance.now();
db.exec("BEGIN IMMEDIATE");
for (let i = 0; i < RECORDS; i++) {
  const kind = KINDS[i % KINDS.length];
  const mine = mines[i % mines.length];
  insert.run(
    `load-${i}`,
    kind,
    mine,
    `Synthetic ${kind} record ${i}`,
    "Safety",
    i % 7 === 0 ? "overdue" : "pending",
    i % 11 === 0 ? "high" : "low",
    "2026-10-15",
    "Load Tester",
    "Synthetic row for measurement only.",
    "{}",
    "u-admin",
    new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    1,
  );
}
db.exec("COMMIT");
const seedMs = performance.now() - started;
const dbBytes = fs.statSync(database).size;

// ---- http ------------------------------------------------------------------
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cookie = await (async () => {
  const res = await fetch(`${origin}/api/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  });
  assert.equal(res.status, 200, "load harness could not sign in");
  return res.headers.getSetCookie()[0].split(";")[0];
})();

const call = async (pathname, options = {}) => {
  const res = await fetch(origin + pathname, {
    ...options,
    headers: {
      cookie,
      origin,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  return { status: res.status, bytes: Buffer.byteLength(text), text, headers: res.headers };
};

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return {
    min: sorted[0],
    p50: pick(50),
    p95: pick(95),
    p99: pick(99),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
};

const measure = async (label, pathname, options = {}) => {
  const latencies = [];
  const sizes = [];
  const errors = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t = performance.now();
    const res = await call(pathname, options);
    latencies.push(performance.now() - t);
    sizes.push(res.bytes);
    if (res.status >= 400) errors.push(res.status);
  }
  const s = stats(latencies);
  return {
    label,
    ...s,
    p95Mean: s.p95,
    errors: errors.length,
    errorRate: (errors.length / ITERATIONS) * 100,
    meanBytes: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
    maxBytes: Math.max(...sizes),
  };
};

const results = [];
results.push(await measure("GET /api/records/compliance", "/api/records/compliance?mine=all&limit=500"));
results.push(await measure("GET /api/dashboard", "/api/dashboard?mine=all"));
results.push(await measure("GET /api/notifications", "/api/notifications?mine=all"));
results.push(await measure("GET /api/audit", "/api/audit?mine=all"));
results.push(await measure("GET /api/reports/csv", "/api/reports/csv?kind=compliance&mine=all"));

// ---- write latency ---------------------------------------------------------
const writeLatencies = [];
for (let i = 0; i < 50; i++) {
  const t = performance.now();
  const res = await call("/api/records/action", {
    method: "POST",
    body: JSON.stringify({
      mineId: mines[0],
      title: `Write probe ${i}`,
      category: "Safety",
      status: "open",
      priority: "medium",
      dueDate: "2026-10-20",
      owner: "Load Tester",
      notes: "synthetic",
      data: { sourceId: "", resolution: "" },
    }),
  });
  writeLatencies.push(performance.now() - t);
  assert.equal(res.status, 201, `write failed with ${res.status}`);
}
const writeStats = stats(writeLatencies);
results.push({
  label: "POST /api/records/action",
  ...writeStats,
  errors: 0,
  errorRate: 0,
  meanBytes: 0,
  maxBytes: 0,
});

// ---- concurrency -----------------------------------------------------------
// 1. Simultaneous updates to one record: optimistic locking must allow exactly
//    one winner and no lost update.
const created = JSON.parse(
  (
    await call("/api/records/action", {
      method: "POST",
      body: JSON.stringify({
        mineId: mines[0],
        title: "Concurrency probe",
        category: "Safety",
        status: "open",
        priority: "low",
        dueDate: "2026-10-20",
        owner: "Load Tester",
        notes: "synthetic",
        data: { sourceId: "", resolution: "" },
      }),
    })
  ).text,
);
const simultaneous = await Promise.all(
  [1, 2, 3, 4, 5].map((n) =>
    call(`/api/records/action/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...created, title: `Concurrent writer ${n}` }),
    }),
  ),
);
const winners = simultaneous.filter((r) => r.status === 200).length;
const conflicts = simultaneous.filter((r) => r.status === 409).length;
assert.equal(winners, 1, `exactly one concurrent update may win, got ${winners}`);
assert.equal(conflicts, 4, `the other writers must see a conflict, got ${conflicts}`);
const rowVersion = db.prepare("SELECT version FROM records WHERE id=?").get(created.id).version;
assert.equal(rowVersion, 2, "a lost update would push the revision higher");

// 2. Duplicate offline replays under concurrency.
const replayBody = JSON.stringify({
  mineId: mines[0],
  title: "Idempotent replay probe",
  category: "Safety",
  status: "open",
  priority: "low",
  dueDate: "2026-10-20",
  owner: "Load Tester",
  notes: "synthetic",
  data: { sourceId: "", resolution: "" },
});
const replays = await Promise.all(
  Array.from({ length: 5 }, () =>
    call("/api/records/action", {
      method: "POST",
      body: replayBody,
      headers: { "idempotency-key": "load-replay-1" },
    }),
  ),
);
assert.ok(replays.every((r) => [200, 201].includes(r.status)));
assert.equal(new Set(replays.map((r) => JSON.parse(r.text).id)).size, 1);
assert.equal(
  db.prepare("SELECT count(*) n FROM records WHERE title='Idempotent replay probe'").get().n,
  1,
  "a replayed offline report must not be stored twice",
);

// 3. Mixed read load: 8 concurrent readers, error rate must stay zero.
const mixedStart = performance.now();
const MIXED_WORKERS = 8;
const MIXED_EACH = 25;
const mixed = (
  await Promise.all(
    Array.from({ length: MIXED_WORKERS }, (_, worker) =>
      Promise.all(
        Array.from({ length: MIXED_EACH }, (_, i) =>
          call(
            worker % 2
              ? "/api/records/compliance?mine=all&limit=100"
              : `/api/dashboard?mine=${mines[i % mines.length]}`,
          ),
        ),
      ),
    ),
  )
).flat();
assert.equal(
  mixed.length,
  MIXED_WORKERS * MIXED_EACH,
  "every concurrent request must be awaited before measuring",
);
const mixedErrors = mixed.filter((r) => r.status >= 400).length;
const mixedSeconds = (performance.now() - mixedStart) / 1000;

// ---- report ----------------------------------------------------------------
const rssMb = (process.memoryUsage().rss / 1048576).toFixed(0);
console.log(`\nSynthetic dataset: ${RECORDS + 100} records, ${mines.length} mines, ${(dbBytes / 1048576).toFixed(1)} MB SQLite, seeded in ${seedMs.toFixed(0)} ms`);
console.log(`Iterations per endpoint: ${ITERATIONS} (single client, sequential)\n`);
console.log("endpoint                          p50      p95      p99      max    meanB    maxB  errors  target ver");
for (const r of results) {
  const target = TARGETS[r.label];
  const verdict = target ? (r.p95 <= target.p95 ? "PASS" : "MISS") : "n/a";
  console.log(
    `${r.label.padEnd(32)}${r.p50.toFixed(1).padStart(7)}ms${r.p95.toFixed(1).padStart(8)}ms${r.p99.toFixed(1).padStart(8)}ms${r.max.toFixed(0).padStart(7)}ms${String(r.meanBytes).padStart(9)}${String(r.maxBytes).padStart(8)}${String(r.errors).padStart(8)}  ${verdict}`,
  );
}
console.log(
  `\nMixed load: ${mixed.length} requests at concurrency ${MIXED_WORKERS} in ${mixedSeconds.toFixed(1)}s = ${(mixed.length / mixedSeconds).toFixed(0)} req/s, ${mixedErrors} errors`,
);
console.log(`Concurrency: optimistic locking allowed 1 winner / 4 conflicts; 5 replayed submissions stored 1 record`);
console.log(`Process RSS after load: ${rssMb} MB\n`);

// Correctness gates (the measurement itself must not only be fast).
assert.equal(mixedErrors, 0, "mixed load must not produce server errors");
const totalScanned = db.prepare("SELECT count(*) n FROM records").get().n;
assert.ok(totalScanned >= RECORDS, "synthetic rows must still be present after the load run");

await new Promise((resolve) => server.close(resolve));
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("Load harness complete: correctness gates passed.");
