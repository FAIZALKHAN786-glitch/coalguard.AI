import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createApp,
  parseTrustProxy,
  pageParams,
  LIST_LIMIT_MAX,
  EXPORT_LIMIT_MAX,
} from "../server/app.js";

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-hardening-"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const start = (options = {}) =>
  createApp({
    database: path.join(dir, `db-${Math.random().toString(36).slice(2)}.sqlite`),
    demo: true,
    ...options,
  });

const base = (overrides = {}) => ({
  mineId: "gevra",
  title: "Hardening observation",
  category: "Safety",
  status: "open",
  priority: "medium",
  dueDate: "2026-10-10",
  owner: "Test Officer",
  notes: "Test evidence",
  data: { sourceId: "", resolution: "" },
  ...overrides,
});

test("TRUST_PROXY configuration is validated and refuses blanket trust", () => {
  assert.equal(parseTrustProxy(undefined), "loopback");
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy(false), false);
  for (const hops of ["1", "2", "5", 1]) assert.equal(parseTrustProxy(hops), Number(hops));
  assert.equal(parseTrustProxy("loopback"), "loopback");
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 192.168.1.0/24"), [
    "10.0.0.0/8",
    "192.168.1.0/24",
  ]);
  assert.throws(() => parseTrustProxy("true"), /TRUST_PROXY=true is refused/);
  assert.throws(() => parseTrustProxy("9"), /TRUST_PROXY must be/);
  assert.throws(() => parseTrustProxy("any-host.example"), /TRUST_PROXY must be/);
});

test("a forged X-Forwarded-For cannot mint fresh rate-limit buckets", async () => {
  // With no trusted proxy configured, every request is attributed to the
  // socket address, so spoofed forwarding headers cannot reset the limiter.
  const untrusted = start({ trustProxy: false });
  try {
    const statuses = [];
    for (let i = 0; i < 31; i++)
      statuses.push(
        (
          await request(untrusted.app)
            .post("/api/auth/demo")
            .set("X-Forwarded-For", `203.0.113.${i}`)
            .send({})
        ).status,
      );
    assert.equal(statuses[30], 429, "the 31st attempt must be limited");

    // The same requests are attributed to the caller as soon as a proxy is
    // trusted, which is why TRUST_PROXY must name only real proxy addresses.
    const trusted = start({ trustProxy: "loopback" });
    try {
      for (let i = 0; i < 31; i++)
        await request(trusted.app)
          .post("/api/auth/demo")
          .set("X-Forwarded-For", `203.0.113.${i}`)
          .send({})
          .expect(200);
    } finally {
      trusted.db.close();
    }
  } finally {
    untrusted.db.close();
  }
});

test("an empty mine assignment never upgrades a field or officer to portfolio access", async () => {
  const instance = start();
  try {
    // Simulates a row that a manual edit or an import left without sites.
    instance.db
      .prepare("UPDATE users SET mines='[]' WHERE id='u-officer'")
      .run();
    const officer = request.agent(instance.app);
    await officer
      .post("/api/auth/login")
      .send({ email: "officer@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    assert.deepEqual((await officer.get("/api/mines").expect(200)).body, []);
    await officer.get("/api/dashboard?mine=nigahi").expect(403);
    assert.deepEqual((await officer.get("/api/records/action").expect(200)).body, []);
    await officer.get("/api/audit").expect(200).expect((r) => assert.deepEqual(r.body, []));
  } finally {
    instance.db.close();
  }
});

test("record lists are scoped, filtered and paginated in SQL", async () => {
  const instance = start();
  try {
    const admin = request.agent(instance.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    const all = await admin
      .get("/api/records/compliance?mine=all")
      .expect(200);
    const total = Number(all.headers["x-total-count"]);
    assert.equal(total, all.body.length);
    assert.ok(total > 2);

    const first = await admin
      .get(`/api/records/compliance?mine=all&limit=1&offset=0`)
      .expect(200);
    const second = await admin
      .get(`/api/records/compliance?mine=all&limit=1&offset=1`)
      .expect(200);
    assert.equal(first.body.length, 1);
    assert.equal(second.body.length, 1);
    assert.equal(first.headers["x-result-limit"], "1");
    assert.notEqual(first.body[0].id, second.body[0].id);
    // Deterministic ordering: repeating a page returns the same rows.
    const repeat = await admin
      .get(`/api/records/compliance?mine=all&limit=1&offset=0`)
      .expect(200);
    assert.equal(repeat.body[0].id, first.body[0].id);

    const scoped = await admin
      .get("/api/records/compliance?mine=gevra")
      .expect(200);
    assert.ok(scoped.body.every((r) => r.mineId === "gevra"));
    assert.ok(Number(scoped.headers["x-total-count"]) < total);

    const filtered = await admin
      .get("/api/records/compliance?mine=all&status=overdue")
      .expect(200);
    assert.ok(filtered.body.length > 0);
    assert.ok(filtered.body.every((r) => r.status === "overdue"));

    const searched = await admin
      .get("/api/records/compliance?mine=all&q=mine%20safety%20return")
      .expect(200);
    assert.ok(searched.body.length > 0);
    assert.ok(
      searched.body.every((r) => /mine safety return/i.test(r.title)),
    );

    await admin.get("/api/records/compliance?mine=all&status=invented").expect(400);
    await admin.get("/api/records/compliance?mine=all&limit=0").expect(400);
    await admin.get("/api/records/compliance?mine=all&limit=abc").expect(400);
    await admin
      .get(`/api/records/compliance?mine=all&limit=${LIST_LIMIT_MAX + 1}`)
      .expect(400);
    await admin.get("/api/records/unknown-kind").expect(404);
  } finally {
    instance.db.close();
  }
});

test("pageParams rejects oversized and malformed windows", () => {
  assert.deepEqual(pageParams({}), { limit: 500, offset: 0 });
  assert.deepEqual(pageParams({ limit: "25", offset: "50" }), {
    limit: 25,
    offset: 50,
  });
  assert.throws(() => pageParams({ limit: "0" }), /limit must be between/);
  assert.throws(() => pageParams({ limit: "-1" }), /whole numbers/);
  assert.throws(() => pageParams({ offset: "1.5" }), /whole numbers/);
});

test("duplicate offline submissions create one record and one audit entry", async () => {
  const instance = start();
  try {
    const field = request.agent(instance.app);
    await field
      .post("/api/auth/login")
      .send({ email: "field@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    const payload = base({
      title: "Duplicate replay",
      data: {
        latitude: 22.3,
        longitude: 82.5,
        accuracy: 15,
        capturedAt: "2026-10-02T04:00:00.000Z",
        locationSource: "device",
      },
    });
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map(() =>
        field
          .post("/api/records/field")
          .set("Idempotency-Key", "replay-key-1")
          .send(payload),
      ),
    );
    for (const res of [a, b, c]) assert.ok([200, 201].includes(res.status));
    assert.equal(a.body.id, b.body.id);
    assert.equal(b.body.id, c.body.id);
    const rows = instance.db
      .prepare("SELECT count(*) n FROM records WHERE title=?")
      .get("Duplicate replay").n;
    assert.equal(rows, 1);
    const entries = instance.db
      .prepare("SELECT count(*) n FROM audit WHERE entity=?")
      .get(`field:${a.body.id}`).n;
    assert.equal(entries, 1, "a replay must not add a second audit entry");
  } finally {
    instance.db.close();
  }
});

test("audit verification detects truncation as well as alteration", async () => {
  const instance = start();
  try {
    const admin = request.agent(instance.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    assert.equal((await admin.get("/api/audit/verify")).body.valid, true);

    const newest = instance.db
      .prepare("SELECT id,hash,payload,actor,actor_name,action,entity,mine_id,created_at,previous_hash FROM audit ORDER BY id DESC LIMIT 1")
      .get();
    instance.db.prepare("DELETE FROM audit WHERE id=?").run(newest.id);
    const truncated = (await admin.get("/api/audit/verify").expect(200)).body;
    assert.equal(truncated.valid, false);
    assert.match(truncated.reason, /shorter than its anchored length/);

    instance.db
      .prepare(
        "INSERT INTO audit(id,actor,actor_name,action,entity,mine_id,payload,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        newest.id,
        newest.actor,
        newest.actor_name,
        newest.action,
        newest.entity,
        newest.mine_id,
        newest.payload,
        newest.created_at,
        newest.previous_hash,
        newest.hash,
      );
    assert.equal((await admin.get("/api/audit/verify")).body.valid, true, "restoring the entry restores a valid chain");
  } finally {
    instance.db.close();
  }
});

test("readiness reports schema state without credentials", async () => {
  const instance = start();
  try {
    const ready = await request(instance.app).get("/api/ready").expect(200);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.schemaVersion, 2);
    assert.equal((await request(instance.app).get("/api/health")).body.ok, true);
  } finally {
    instance.db.close();
  }
});

test("document lists leak no extraction or storage detail and stay bounded", async () => {
  const instance = start();
  try {
    const officer = request.agent(instance.app);
    const admin = request.agent(instance.app);
    await officer
      .post("/api/auth/login")
      .send({ email: "officer@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    await admin.post("/api/auth/demo").send({}).expect(200);
    const created = (
      await officer
        .post("/api/documents")
        .field("mineId", "gevra")
        .attach("file", Buffer.from("Extraction body for scoping check."), "evidence.txt")
        .expect(201)
    ).body;
    assert.match(created.text, /scoping check/);

    const list = (await officer.get("/api/documents").expect(200)).body;
    const listed = list.find((d) => d.id === created.id);
    assert.ok(listed);
    assert.equal(listed.text, undefined, "lists must not ship stored extractions");
    assert.equal(listed.storage_name, undefined);
    assert.equal(listed.created_by, undefined);
    assert.equal(listed.textLength, "Extraction body for scoping check.".length);

    const detail = await admin.get(`/api/documents/${created.id}`).expect(200);
    assert.match(detail.body.text, /scoping check/);
    assert.equal(detail.body.storage_name, undefined);
    await officer.get("/api/documents/does-not-exist").expect(404);

    const otherMine = request.agent(instance.app);
    await otherMine
      .post("/api/auth/login")
      .send({ email: "field@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    // Field staff are limited to gevra, so a document there is readable; the
    // scoping check that matters is an unassigned mine.
    const hidden = (
      await admin
        .post("/api/documents")
        .field("mineId", "nigahi")
        .attach("file", Buffer.from("Other mine evidence"), "other.txt")
        .expect(201)
    ).body;
    await otherMine.get(`/api/documents/${hidden.id}`).expect(403);
    await otherMine.get(`/api/documents/${hidden.id}/download`).expect(403);
    const scopedList = (await otherMine.get("/api/documents").expect(200)).body;
    assert.ok(scopedList.every((d) => d.mine_id !== "nigahi"));
  } finally {
    instance.db.close();
  }
});

test("exports refuse to build an unbounded file", async () => {
  const instance = start();
  try {
    const admin = request.agent(instance.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    const insert = instance.db.prepare(
      "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    instance.db.exec("BEGIN IMMEDIATE");
    for (let i = 0; i <= EXPORT_LIMIT_MAX; i++)
      insert.run(
        `bulk-${i}`,
        "action",
        "gevra",
        `Bulk row ${i}`,
        "Safety",
        "open",
        "low",
        "2026-10-01",
        "Bulk",
        "",
        "{}",
        "u-admin",
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      );
    instance.db.exec("COMMIT");
    const limited = await admin
      .get("/api/reports/csv?kind=action&mine=gevra")
      .expect(413);
    assert.match(limited.body.error, /limited to 10000 rows/);
    // Narrowing the scope yields a real file again.
    const narrow = await admin
      .get("/api/reports/csv?kind=action&mine=gevra&from=2026-10-02")
      .expect(200);
    assert.match(narrow.text, /"ID","Mine"/);
  } finally {
    instance.db.close();
  }
});

test("production framing and proxy defaults are not demonstration defaults", async () => {
  const previous = process.env.NODE_ENV;
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL;
  process.env.NODE_ENV = "production";
  process.env.ADMIN_PASSWORD = "Production-Password-2026";
  process.env.ADMIN_EMAIL = "framing-check@example.in";
  try {
    const instance = createApp({
      database: path.join(dir, "production.sqlite"),
      demo: false,
    });
    try {
      const res = await request(instance.app).get("/api/health").expect(200);
      const csp = res.headers["content-security-policy"];
      assert.ok(csp, "production must send a policy");
      assert.match(csp, /frame-ancestors 'self'/);
      assert.ok(
        !/arena\.ai/.test(csp),
        "a real deployment must not be frameable by preview hosts",
      );
      assert.equal(res.headers["x-frame-options"], undefined);
    } finally {
      instance.db.close();
    }

    // An operator who really does embed the workspace can name the host.
    process.env.FRAME_ANCESTORS = "https://ops.example.in";
    const framed = createApp({
      database: path.join(dir, "production-frame-env.sqlite"),
      demo: false,
    });
    try {
      const csp = (await request(framed.app).get("/api/health").expect(200))
        .headers["content-security-policy"];
      assert.match(csp, /frame-ancestors 'self' https:\/\/ops\.example\.in/);
    } finally {
      framed.db.close();
      delete process.env.FRAME_ANCESTORS;
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = password;
    if (email === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = email;
  }
});

test("abusive request bodies are rejected with consistent JSON errors", async () => {
  const instance = start();
  try {
    const admin = request.agent(instance.app);
    await admin.post("/api/auth/demo").send({}).expect(200);

    const malformed = await admin
      .post("/api/records/action")
      .set("content-type", "application/json")
      .send('{"mineId":')
      .expect(400);
    assert.equal(typeof malformed.body.error, "string");
    assert.ok(
      !/node_modules|\bat [A-Za-z]+\./.test(malformed.body.error),
      "errors must not leak stack frames",
    );

    const oversized = await admin
      .post("/api/records/action")
      .send(base({ notes: "x".repeat(200000) }))
      .expect(413);
    assert.equal(typeof oversized.body.error, "string");

    const bigUpload = await admin
      .post("/api/documents")
      .field("mineId", "gevra")
      .attach("file", Buffer.alloc(11 * 1024 * 1024, 1), "large.pdf")
      .expect(400);
    assert.match(bigUpload.body.error, /10 MB/);

    // Extra fields in a body are ignored rather than applied.
    const field = request.agent(instance.app);
    await field
      .post("/api/auth/login")
      .send({ email: "field@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    const created = (
      await field
        .post("/api/records/field")
        .send(
          base({
            role: "admin",
            mineId: "gevra",
            data: {
              latitude: null,
              longitude: null,
              accuracy: null,
              capturedAt: new Date().toISOString(),
              locationSource: "unavailable",
            },
          }),
        )
        .expect(201)
    ).body;
    assert.equal(created.role, undefined);
    assert.equal((await field.get("/api/users").expect(403)).statusCode, 403);
  } finally {
    instance.db.close();
  }
});

test("a record cannot be moved into an unassigned mine", async () => {
  const instance = start();
  try {
    const admin = request.agent(instance.app);
    const officer = request.agent(instance.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    await officer
      .post("/api/auth/login")
      .send({ email: "officer@coalguard.demo", password: "CoalGuard@2026" })
      .expect(200);
    const row = (
      await officer.post("/api/records/action").send(base()).expect(201)
    ).body;
    // gevra and dipka are assigned to this officer; nigahi is not.
    await officer
      .patch(`/api/records/action/${row.id}`)
      .send({ ...row, mineId: "nigahi" })
      .expect(403);
    const unchanged = (
      await admin.get(`/api/records/action?mine=gevra`).expect(200)
    ).body.find((r) => r.id === row.id);
    assert.equal(unchanged.mineId, "gevra");
    assert.equal(unchanged.version, 1, "a rejected move must not bump the revision");
  } finally {
    instance.db.close();
  }
});

test("an extraction interrupted by a restart is recoverable, never stuck", async () => {
  const database = path.join(dir, "restart.sqlite");
  const uploads = path.join(dir, "restart-uploads");
  const first = start({ database, uploads });
  try {
    const admin = request.agent(first.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    await admin
      .post("/api/documents")
      .field("mineId", "gevra")
      .attach("file", Buffer.from("Restart recovery evidence"), "restart.txt")
      .expect(201);
    // Simulate a process that died midway through extraction.
    first.db
      .prepare("UPDATE documents SET status='processing' WHERE name='restart.txt'")
      .run();
  } finally {
    first.db.close();
  }
  const restarted = start({ database, uploads });
  try {
    const admin = request.agent(restarted.app);
    await admin.post("/api/auth/demo").send({}).expect(200);
    const target = restarted.db
      .prepare("SELECT id,status FROM documents WHERE name='restart.txt'")
      .get();
    assert.equal(
      target.status,
      "failed",
      "a document left mid-extraction must be marked failed at startup, never processing",
    );
    await admin.post(`/api/documents/${target.id}/retry`).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      restarted.db.prepare("SELECT status FROM documents WHERE id=?").get(target.id)
        .status,
      "ready",
      "a failed extraction must be retryable back to ready",
    );
    const recoveredText = (
      await admin.get(`/api/documents/${target.id}`).expect(200)
    ).body.text;
    assert.match(recoveredText, /Restart recovery evidence/);
  } finally {
    restarted.db.close();
  }
});
