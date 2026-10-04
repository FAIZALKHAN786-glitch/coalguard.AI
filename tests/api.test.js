import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
let app, db, admin, officer, field, regulator, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-test-"));
  ({ app, db } = createApp({
    database: path.join(dir, "test.sqlite"),
    demo: true,
  }));
  admin = request.agent(app);
  officer = request.agent(app);
  field = request.agent(app);
  regulator = request.agent(app);
  await admin.post("/api/auth/demo").send({}).expect(200);
  for (const [agent, email] of [
    [officer, "officer"],
    [field, "field"],
    [regulator, "regulator"],
  ])
    await agent
      .post("/api/auth/login")
      .send({ email: `${email}@coalguard.demo`, password: "CoalGuard@2026" })
      .expect(200);
});
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const base = (overrides = {}) => ({
  mineId: "gevra",
  title: "Test observation",
  category: "Safety",
  status: "open",
  priority: "medium",
  dueDate: "2026-10-10",
  owner: "Test Officer",
  notes: "Test evidence",
  data: { sourceId: "", resolution: "" },
  ...overrides,
});
test("authentication is required and invalid passwords are rejected", async () => {
  await request(app).get("/api/dashboard").expect(401);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@coalguard.demo", password: "incorrect" })
    .expect(401);
});
test("health and deployment metadata are available without credentials", async () => {
  assert.equal((await request(app).get("/api/health")).body.ok, true);
  assert.equal((await request(app).get("/api/config")).body.demo, true);
});
test("sessions use HttpOnly same-site cookies", async () => {
  const res = await request(app).post("/api/auth/demo").send({}).expect(200);
  assert.match(res.headers["set-cookie"][0], /HttpOnly/);
  assert.match(res.headers["set-cookie"][0], /SameSite=Lax/);
  assert.ok(!res.body.user.password);
});
test("officers see only assigned mines and cannot query another scope", async () => {
  const mines = (await officer.get("/api/mines").expect(200)).body;
  assert.deepEqual(mines.map((m) => m.id).sort(), ["dipka", "gevra"]);
  await officer.get("/api/dashboard?mine=nigahi").expect(403);
  const rows = (await officer.get("/api/records/compliance")).body;
  assert.ok(rows.every((r) => ["gevra", "dipka"].includes(r.mineId)));
});
test("regulators cannot create, alter or delete operational records", async () => {
  await regulator.post("/api/records/action").send(base()).expect(403);
  const row = (await admin.get("/api/records/action")).body[0];
  await regulator.patch(`/api/records/action/${row.id}`).send(row).expect(403);
  await regulator.delete(`/api/records/action/${row.id}`).expect(403);
});
test("field staff cannot author compliance or access unassigned mines", async () => {
  await field.post("/api/records/compliance").send(base()).expect(403);
  await field.get("/api/records/field?mine=dipka").expect(403);
  await field
    .post("/api/records/field")
    .send(
      base({
        mineId: "dipka",
        data: {
          latitude: null,
          longitude: null,
          accuracy: null,
          capturedAt: new Date().toISOString(),
          locationSource: "unavailable",
        },
      }),
    )
    .expect(403);
});
test("create, update and delete preserve a verifiable audit trail", async () => {
  const created = (
    await admin.post("/api/records/action").send(base()).expect(201)
  ).body;
  assert.equal(created.version, 1);
  const updated = (
    await admin
      .patch(`/api/records/action/${created.id}`)
      .send({
        ...created,
        status: "resolved",
        data: { ...created.data, resolution: "Inspected and rectified." },
      })
      .expect(200)
  ).body;
  assert.equal(updated.version, 2);
  await admin.delete(`/api/records/action/${created.id}`).expect(200);
  const check = (await admin.get("/api/audit/verify").expect(200)).body;
  assert.equal(check.valid, true);
  assert.ok(check.count >= 4);
  const entries = (await admin.get("/api/audit")).body.filter((a) =>
    a.entity.endsWith(created.id),
  );
  assert.equal(entries.length, 3);
});
test("optimistic locking rejects stale revisions", async () => {
  const row = (await admin.post("/api/records/action").send(base()).expect(201))
    .body;
  await admin
    .patch(`/api/records/action/${row.id}`)
    .send({ ...row, title: "First update" })
    .expect(200);
  await admin
    .patch(`/api/records/action/${row.id}`)
    .send({ ...row, title: "Stale update" })
    .expect(409);
});
test("resolved actions require resolution evidence", async () => {
  await admin
    .post("/api/records/action")
    .send(base({ status: "resolved" }))
    .expect(400);
});
test("compliance approval is restricted to administrators and requires notes", async () => {
  const payload = base({
    status: "under_review",
    data: { regulation: "Example control", documentId: "" },
  });
  const row = (
    await officer.post("/api/records/compliance").send(payload).expect(201)
  ).body;
  await officer
    .patch(`/api/records/compliance/${row.id}`)
    .send({ ...row, status: "compliant" })
    .expect(403);
  await admin
    .patch(`/api/records/compliance/${row.id}`)
    .send({ ...row, status: "compliant", notes: "" })
    .expect(400);
  await admin
    .patch(`/api/records/compliance/${row.id}`)
    .send({
      ...row,
      status: "compliant",
      notes: "Authorized review completed against evidence.",
    })
    .expect(200);
  assert.equal((await admin.get("/api/audit")).body[0].action, "approved");
});
test("cross-mine evidence and action-source references are rejected", async () => {
  const source = (await admin.get("/api/records/inspection?mine=nigahi"))
    .body[0];
  await admin
    .post("/api/records/action")
    .send(base({ data: { sourceId: source.id, resolution: "" } }))
    .expect(400);
  await admin
    .post("/api/records/compliance")
    .send(
      base({
        status: "pending",
        data: { regulation: "Example", documentId: "nonexistent" },
      }),
    )
    .expect(400);
});
test("dates, status, coordinates and numeric values are validated", async () => {
  await admin
    .post("/api/records/action")
    .send(base({ dueDate: "2026-02-30" }))
    .expect(400);
  await admin
    .post("/api/records/action")
    .send(base({ status: "invented" }))
    .expect(400);
  await admin
    .post("/api/records/operation")
    .send(
      base({
        status: "submitted",
        data: { tonnes: -1, target: 20, shift: "Morning" },
      }),
    )
    .expect(400);
  await admin
    .post("/api/records/field")
    .send(
      base({
        data: {
          latitude: 99,
          longitude: 82,
          capturedAt: new Date().toISOString(),
          locationSource: "device",
        },
      }),
    )
    .expect(400);
});
test("offline submissions are idempotent and retain capture time", async () => {
  const capturedAt = "2026-10-01T08:00:00.000Z";
  const p = base({
    data: {
      latitude: 22.3,
      longitude: 82.5,
      accuracy: 15,
      capturedAt,
      locationSource: "device",
    },
  });
  const a = (
    await field
      .post("/api/records/field")
      .set("Idempotency-Key", "offline-test-1")
      .send(p)
      .expect(201)
  ).body;
  const b = (
    await field
      .post("/api/records/field")
      .set("Idempotency-Key", "offline-test-1")
      .send(p)
      .expect(200)
  ).body;
  assert.equal(a.id, b.id);
  assert.equal(b.data.capturedAt, capturedAt);
});
test("dashboard aggregates stored records, not static counters", async () => {
  const d = (await admin.get("/api/dashboard?mine=gevra")).body;
  const rows = (await admin.get("/api/records/compliance?mine=gevra")).body;
  assert.equal(d.totalCompliance, rows.length);
  assert.equal(
    d.compliance,
    Math.round(
      (rows.filter((r) => r.status === "compliant").length / rows.length) * 100,
    ),
  );
  assert.equal(d.mines.length, 1);
  assert.equal(d.trend.length, 14);
});
test("notifications can be acknowledged persistently", async () => {
  const notices = (await admin.get("/api/notifications")).body;
  assert.ok(notices.length);
  await admin
    .post("/api/notifications/read")
    .send({ ids: [notices[0].id] })
    .expect(200);
  assert.equal(
    (await admin.get("/api/notifications")).body.find(
      (n) => n.id === notices[0].id,
    ).read,
    true,
  );
});
test("text document upload, extraction and authorized download work", async () => {
  const d = (
    await officer
      .post("/api/documents")
      .field("mineId", "gevra")
      .attach(
        "file",
        Buffer.from("Inspection evidence: haul road drainage checked."),
        "inspection.txt",
      )
      .expect(201)
  ).body;
  assert.equal(d.status, "ready");
  assert.match(d.text, /drainage/);
  assert.equal(d.storage_name, undefined);
  const download = await admin
    .get(`/api/documents/${d.id}/download`)
    .expect(200);
  assert.match(download.headers["content-disposition"], /attachment/);
  assert.match(download.text, /drainage/);
  await officer
    .post("/api/documents")
    .field("mineId", "nigahi")
    .attach("file", Buffer.from("Private document"), "private.txt")
    .expect(403);
});
test("unsupported uploads and read-only document writes are rejected", async () => {
  await admin
    .post("/api/documents")
    .field("mineId", "gevra")
    .attach("file", Buffer.from("<script>alert(1)</script>"), "script.html")
    .expect(400);
  await regulator
    .post("/api/documents")
    .field("mineId", "gevra")
    .attach("file", Buffer.from("test"), "test.txt")
    .expect(403);
});
test("CSV exports escape spreadsheet formula injection and PDF has a valid header", async () => {
  await admin
    .post("/api/records/action")
    .send(base({ title: '=HYPERLINK("unsafe")' }))
    .expect(201);
  const csv = await admin
    .get("/api/reports/csv?kind=action&mine=gevra")
    .expect(200);
  assert.match(csv.text, /"'=HYPERLINK/);
  const pdf = await admin
    .get("/api/reports/pdf?kind=compliance&mine=gevra")
    .expect(200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  await admin.get("/api/reports/csv?from=2026-10-10&to=2026-09-01").expect(400);
});
test("unconfigured AI is clearly labelled rules, with no invented model output", async () => {
  const r = (
    await admin
      .post("/api/ai/chat")
      .send({ question: "What are the risks?", mineId: "gevra" })
      .expect(200)
  ).body;
  assert.equal(r.mode, "rules");
  assert.match(r.answer, /not connected/);
  const review = (
    await admin.post("/api/ai/analysis").send({ mineId: "gevra" }).expect(200)
  ).body;
  assert.equal(review.mode, "rules");
  await officer
    .post("/api/ai/chat")
    .send({ question: "Show this mine", mineId: "nigahi" })
    .expect(403);
});
test("only administrators manage users and secrets never return in responses", async () => {
  await officer.get("/api/users").expect(403);
  await admin
    .post("/api/users")
    .send({
      name: "New Officer",
      email: "new@example.in",
      password: "StrongPassword@2026",
      role: "officer",
      mines: [],
    })
    .expect(400);
  const r = await admin
    .post("/api/users")
    .send({
      name: "New Officer",
      email: "new@example.in",
      password: "StrongPassword@2026",
      role: "officer",
      mines: ["gevra"],
    })
    .expect(201);
  assert.equal(r.body.password, undefined);
  assert.ok((await admin.get("/api/users")).body.every((u) => !u.password));
  await admin
    .post("/api/users")
    .send({
      name: "Other",
      email: "new@example.in",
      password: "StrongPassword@2026",
      role: "officer",
      mines: ["gevra"],
    })
    .expect(409);
});
test("cross-site writes are rejected", async () => {
  await admin
    .post("/api/records/action")
    .set("Origin", "https://untrusted.example")
    .send(base())
    .expect(403);
  await admin
    .post("/api/records/action")
    .set("Sec-Fetch-Site", "cross-site")
    .send(base())
    .expect(403);
});
test("audit verification detects database tampering", async () => {
  const old = db
    .prepare("SELECT id,payload FROM audit ORDER BY id LIMIT 1")
    .get();
  db.prepare("UPDATE audit SET payload=? WHERE id=?").run(
    '{"tampered":true}',
    old.id,
  );
  assert.equal((await admin.get("/api/audit/verify")).body.valid, false);
  db.prepare("UPDATE audit SET payload=? WHERE id=?").run(old.payload, old.id);
  assert.equal((await admin.get("/api/audit/verify")).body.valid, true);
});
test("sign-out revokes the server session", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({}).expect(200);
  await agent.post("/api/auth/logout").send({}).expect(200);
  await agent.get("/api/auth/me").expect(401);
});

test("production rejects known demo data and unconfigured bootstrap", () => {
  assert.throws(
    () => createApp({ database: path.join(dir, "test.sqlite"), demo: false }),
    /demonstration database/,
  );
  const password = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  assert.throws(
    () => createApp({ database: path.join(dir, "fresh.sqlite"), demo: false }),
    /ADMIN_PASSWORD/,
  );
  if (password !== undefined) process.env.ADMIN_PASSWORD = password;
});

test("embedded demo cookies are partitioned, secure, HttpOnly, and cleared on logout", async () => {
  const instance = createApp({
    database: path.join(dir, "embedded.sqlite"),
    demo: true,
    embeddedPreview: true,
  });
  try {
    const login = await request(instance.app)
      .post("/api/auth/demo")
      .send({})
      .expect(200);
    const cookie = login.headers["set-cookie"][0];
    assert.match(cookie, /^__Host-coalguard_preview_session=/);
    for (const flag of [
      "Secure",
      "HttpOnly",
      "SameSite=None",
      "Partitioned",
      "Path=/",
    ])
      assert.ok(cookie.includes(flag));
    assert.equal(login.body.token, undefined);
    const token = cookie.split(";")[0];
    await request(instance.app)
      .get("/api/auth/me")
      .set("Cookie", token)
      .expect(200);
    await request(instance.app)
      .post("/api/records/action")
      .set("Cookie", token)
      .set("Origin", "https://untrusted.example")
      .send(base())
      .expect(403);
    const logout = await request(instance.app)
      .post("/api/auth/logout")
      .set("Cookie", token)
      .send({})
      .expect(200);
    assert.match(logout.headers["set-cookie"][0], /Partitioned/);
    assert.match(logout.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/);
    await request(instance.app)
      .get("/api/auth/me")
      .set("Cookie", token)
      .expect(401);
  } finally {
    instance.db.close();
  }
});
test("embedded preview cookie mode cannot be enabled for a non-demo workspace", () => {
  assert.throws(
    () => createApp({ demo: false, embeddedPreview: true }),
    /restricted to demonstration/,
  );
});

test("cookie-free preview sessions are scoped, short-lived, revocable, and never accepted by normal mode", async () => {
  const instance = createApp({
    database: path.join(dir, "fallback.sqlite"),
    demo: true,
    embeddedPreview: true,
  });
  try {
    const login = await request(instance.app)
      .post("/api/auth/login")
      .send({
        email: "officer@coalguard.demo",
        password: "CoalGuard@2026",
        sessionTransport: "memory",
      })
      .expect(200);
    assert.equal(login.body.transport, "memory");
    assert.match(login.body.accessToken, /^[a-f0-9]{64}$/);
    const authorization = `Bearer ${login.body.accessToken}`;
    await request(instance.app)
      .get("/api/auth/me")
      .set("X-CoalGuard-Session", login.body.accessToken)
      .expect(200);
    await request(instance.app)
      .get("/api/dashboard?mine=nigahi")
      .set("X-CoalGuard-Session", login.body.accessToken)
      .expect(403);
    await request(app)
      .get("/api/auth/me")
      .set("X-CoalGuard-Session", login.body.accessToken)
      .expect(401);
    await request(instance.app)
      .get("/api/auth/me")
      .set("X-CoalGuard-Session", "invalid")
      .expect(401);
    const mineList = await request(instance.app)
      .get("/api/mines")
      .set("Authorization", authorization)
      .expect(200);
    assert.deepEqual(mineList.body.map((m) => m.id).sort(), ["dipka", "gevra"]);
    await request(instance.app)
      .get("/api/dashboard?mine=nigahi")
      .set("Authorization", authorization)
      .expect(403);
    await request(instance.app).get("/api/dashboard").expect(401);
    await request(instance.app)
      .get("/api/reports/csv?mine=gevra")
      .set("Authorization", authorization)
      .expect(200);
    assert.ok(
      instance.db
        .prepare("SELECT expires FROM sessions ORDER BY expires DESC LIMIT 1")
        .get().expires <=
        Date.now() + 3600000,
    );
    await request(instance.app)
      .post("/api/auth/logout")
      .set("Authorization", authorization)
      .send({})
      .expect(200);
    await request(instance.app)
      .get("/api/auth/me")
      .set("Authorization", authorization)
      .expect(401);
    await request(app)
      .post("/api/auth/demo")
      .send({ sessionTransport: "memory" })
      .expect(400);
    await request(app)
      .get("/api/auth/me")
      .set("Authorization", authorization)
      .expect(401);
    await request(instance.app)
      .post("/api/auth/login")
      .send({
        email: "officer@coalguard.demo",
        password: "wrong",
        sessionTransport: "memory",
      })
      .expect(401);
    const regular = await request(instance.app)
      .post("/api/auth/demo")
      .send({})
      .expect(200);
    assert.equal(regular.body.accessToken, undefined);
  } finally {
    instance.db.close();
  }
});
test("explicit public origin works behind a proxy without trusting arbitrary forwarded hosts", async () => {
  const instance = createApp({
    database: path.join(dir, "proxy.sqlite"),
    demo: true,
    embeddedPreview: true,
    publicOrigin: "https://preview.example",
  });
  try {
    await request(instance.app)
      .post("/api/auth/demo")
      .set("Origin", "https://preview.example")
      .set("Host", "internal-backend:5173")
      .send({})
      .expect(200);
    await request(instance.app)
      .post("/api/auth/demo")
      .set("Origin", "https://attacker.example")
      .set("Host", "internal-backend:5173")
      .set("X-Forwarded-Host", "attacker.example")
      .send({})
      .expect(403);
    await request(instance.app)
      .post("/api/auth/demo")
      .set("Origin", "http://preview.example")
      .send({})
      .expect(403);
  } finally {
    instance.db.close();
  }
});
