// Boots the application the way a real deployment does: NODE_ENV=production,
// demo disabled, a fresh database, and an administrator supplied only through
// environment configuration. Everything here uses temporary paths and
// fabricated credentials.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";

const ADMIN_EMAIL = "deployment-admin@example.in";
const ADMIN_PASSWORD = "Fabricated-Deployment-Password-2026";

let dir;
process.env.NODE_ENV = "production";
process.env.DEMO_MODE = "false";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
delete process.env.EMBEDDED_PREVIEW;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-production-"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const boot = (name, options = {}) =>
  createApp({
    database: path.join(dir, `${name}.sqlite`),
    uploads: path.join(dir, `${name}-uploads`),
    ...options,
  });

test("a fresh production deployment starts, reports ready, and refuses demo access", async () => {
  const instance = boot("production");
  try {
    const { app, db } = instance;
    const health = await request(app).get("/api/health").expect(200);
    assert.equal(health.body.ok, true);

    const ready = await request(app).get("/api/ready").expect(200);
    assert.deepEqual(ready.body, { ready: true, schemaVersion: 2 });

    assert.equal((await request(app).get("/api/config").expect(200)).body.demo, false);

    // Demo sign-in exists only in a demonstration workspace.
    await request(app).post("/api/auth/demo").send({}).expect(404);

    // Seeded demonstration credentials must not work in production.
    for (const email of [
      "admin@coalguard.demo",
      "officer@coalguard.demo",
      "field@coalguard.demo",
      "regulator@coalguard.demo",
    ])
      await request(app)
        .post("/api/auth/login")
        .send({ email, password: "CoalGuard@2026" })
        .expect(401);

    // The configured production administrator can sign in.
    const admin = request.agent(app);
    await admin
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const users = (await admin.get("/api/users").expect(200)).body;
    assert.deepEqual(users.map((u) => u.email), [ADMIN_EMAIL]);
    assert.ok(
      db.prepare("SELECT count(*) n FROM mines").get().n === 0,
      "a production database must start without demonstration mines",
    );
    assert.equal(
      (await admin.get("/api/audit/verify").expect(200)).body.valid,
      true,
    );

    const csp = (await request(app).get("/api/health")).headers[
      "content-security-policy"
    ];
    assert.match(csp, /frame-ancestors 'self'/);
    assert.ok(!/arena\.ai/.test(csp));
    assert.equal(
      (await request(app).get("/api/health")).headers["x-powered-by"],
      undefined,
    );
    // The demonstration-only session fallback is never issued here.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    assert.equal(login.body.accessToken, undefined);
    assert.equal(login.headers["set-cookie"][0].includes("Partitioned"), false);
  } finally {
    instance.db.close();
  }
});

test("production fails closed when mandatory configuration is missing", () => {
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  assert.throws(() => boot("missing-password"), /ADMIN_PASSWORD/);
  process.env.ADMIN_PASSWORD = "short";
  assert.throws(() => boot("short-password"), /ADMIN_PASSWORD/);
  process.env.ADMIN_PASSWORD = password;
  process.env.ADMIN_EMAIL = "not-an-email";
  assert.throws(() => boot("bad-email"), /ADMIN_EMAIL/);
  process.env.ADMIN_EMAIL = email;
});

test("an HTTPS origin without secure cookies is refused", () => {
  const origin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://coalguard.example.in";
  assert.throws(() => boot("insecure-cookie"), /COOKIE_SECURE/);
  delete process.env.APP_ORIGIN;
  process.env.COOKIE_SECURE = "true";
  const secure = boot("secure-cookie", {
    publicOrigin: "https://coalguard.example.in",
  });
  // Assigning undefined to process.env would store the string "undefined".
  if (origin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = origin;
  delete process.env.COOKIE_SECURE;
  secure.db.close();
});

test("an existing demonstration database is refused in production", () => {
  const database = path.join(dir, "demo-source.sqlite");
  const demoInstance = createApp({ database, demo: true });
  demoInstance.db.close();
  assert.throws(
    () => createApp({ database, demo: false }),
    /demonstration database/,
  );
});

test("demo mode cannot be entered by omitting configuration", () => {
  // DEMO_MODE unset with NODE_ENV=production must resolve to production.
  const demo = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  const instance = createApp({
    database: path.join(dir, "implicit-production.sqlite"),
  });
  try {
    assert.equal(instance.db.prepare("SELECT count(*) n FROM users").get().n, 1);
    assert.equal(
      instance.db.prepare("SELECT count(*) n FROM mines").get().n,
      0,
      "no demonstration content may be seeded implicitly",
    );
  } finally {
    instance.db.close();
    process.env.DEMO_MODE = demo;
  }
});

test("the embedded-preview cookie mode is refused outside demo mode", () => {
  assert.throws(
    () => boot("preview-in-production", { embeddedPreview: true }),
    /restricted to demonstration/,
  );
});

test("production rejects writes without a session and unknown API paths", async () => {
  const instance = boot("access-control");
  try {
    await request(instance.app).post("/api/records/action").send({}).expect(401);
    await request(instance.app).get("/api/dashboard").expect(401);
    await request(instance.app).get("/api/does-not-exist").expect(401);
  } finally {
    instance.db.close();
  }
});
