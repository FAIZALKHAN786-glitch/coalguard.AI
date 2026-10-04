import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import {
  aiPolicy,
  readProviderKey,
  providerUrl,
} from "../server/ai-security.js";
import { chat, decision, aiStatus } from "../server/ai.js";
import { createApp } from "../server/app.js";
const originalFetch = globalThis.fetch;
const initialEnv = { ...process.env };
const keys = [
  "AI_ENABLED",
  "AI_ALLOWED_HOSTS",
  "DEMO_MODE",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  ...["TEXT", "DECISION", "EMBEDDING", "RERANK"].flatMap((type) =>
    ["BASE_URL", "MODEL", "API_KEY", "API_KEY_FILE"].map(
      (key) => `AI_${type}_${key}`,
    ),
  ),
];
const directories = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (initialEnv[key] === undefined) delete process.env[key];
    else process.env[key] = initialEnv[key];
  }
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-secrets-test-"));
  directories.push(dir);
  return dir;
}
function configure(type = "TEXT") {
  process.env[`AI_${type}_BASE_URL`] = "https://openrouter.ai/api/v1";
  process.env[`AI_${type}_MODEL`] = "test-model";
  process.env[`AI_${type}_API_KEY`] = "fictional-test-credential";
  process.env.AI_ENABLED = "true";
  process.env.DEMO_MODE = "false";
  process.env.AI_ALLOWED_HOSTS = "openrouter.ai";
}
function fakeDb() {
  return {
    prepare() {
      throw Error("No embedding provider should have been called");
    },
  };
}
test("external AI requires explicit activation and remains disabled in demo mode", () => {
  delete process.env.AI_ENABLED;
  assert.equal(aiPolicy(false).allowExternal, false);
  process.env.AI_ENABLED = "true";
  assert.equal(aiPolicy(false).allowExternal, true);
  assert.equal(aiPolicy(true).allowExternal, false);
});
test("credential file is loaded without embedding its contents in configuration/status", async () => {
  configure();
  delete process.env.AI_TEXT_API_KEY;
  const file = path.join(temp(), "key");
  fs.writeFileSync(file, "fictional-mounted-secret\n", { mode: 0o600 });
  process.env.AI_TEXT_API_KEY_FILE = file;
  assert.equal(readProviderKey("TEXT"), "fictional-mounted-secret");
  assert.ok(aiStatus().text);
  assert.ok(!JSON.stringify(aiStatus()).includes("fictional-mounted-secret"));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(
      options.headers.Authorization,
      "Bearer fictional-mounted-secret",
    );
    assert.equal(options.redirect, "error");
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Advisory response." } }],
      }),
    };
  };
  const result = await chat(
    fakeDb(),
    "What should we review?",
    [],
    [],
    [],
    [],
    aiPolicy(false),
  );
  assert.equal(result.mode, "model");
  assert.equal(calls, 1);
});
test("conflicting, invalid, absent, and oversized credential files fail without exposing secrets or paths", () => {
  configure();
  const dir = temp();
  const file = path.join(dir, "key");
  fs.writeFileSync(file, "not-a-real-key");
  process.env.AI_TEXT_API_KEY_FILE = file;
  assert.throws(() => readProviderKey("TEXT"), /conflicting/);
  delete process.env.AI_TEXT_API_KEY;
  for (const invalid of [
    "relative-secret-path",
    dir,
    path.join(dir, "missing"),
  ]) {
    process.env.AI_TEXT_API_KEY_FILE = invalid;
    assert.throws(
      () => readProviderKey("TEXT"),
      (e) =>
        e.message.includes("credential is unavailable") &&
        !e.message.includes(dir),
    );
  }
  process.env.AI_TEXT_API_KEY_FILE = file;
  fs.writeFileSync(file, "x".repeat(8193));
  assert.throws(() => readProviderKey("TEXT"), /unavailable/);
  fs.writeFileSync(file, "bad\ncredential");
  assert.throws(() => readProviderKey("TEXT"), /invalid/);
});
test("provider destinations must be exact approved HTTPS hosts and cannot hide URL credentials", () => {
  process.env.AI_ALLOWED_HOSTS = "openrouter.ai";
  assert.equal(
    providerUrl("https://openrouter.ai/api/v1", "/chat/completions").hostname,
    "openrouter.ai",
  );
  for (const base of [
    "http://openrouter.ai/api/v1",
    "https://openrouter.ai.attacker.example/v1",
    "https://api.openai.com/v1",
    "https://user:password@openrouter.ai/v1",
    "https://openrouter.ai:444/v1",
    "https://openrouter.ai/v1?key=credential",
    "https://openrouter.ai/v1#fragment",
    "https://127.0.0.1/v1",
  ])
    assert.throws(() => providerUrl(base, "/chat/completions"));
});
test("public demo makes no external text, decision, embedding, or reranking calls even with credentials and a forged request flag", async () => {
  for (const type of ["TEXT", "DECISION", "EMBEDDING", "RERANK"])
    configure(type);
  // Set server option demo=true independently of environment to test route policy.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Provider must not be contacted");
  };
  const dir = temp();
  const { app, db } = createApp({
    database: path.join(dir, "demo.sqlite"),
    demo: true,
  });
  try {
    const user = request.agent(app);
    await user.post("/api/auth/demo").send({}).expect(200);
    await user
      .post("/api/documents")
      .field("mineId", "gevra")
      .attach("file", Buffer.from("Safety review evidence"), "evidence.txt")
      .expect(201);
    const response = await user
      .post("/api/ai/chat")
      .send({
        question: "Review safety evidence",
        mineId: "gevra",
        allowExternal: true,
      })
      .expect(200);
    assert.equal(response.body.mode, "rules");
    assert.match(response.body.answer, /disabled in demonstration/);
    const review = await user
      .post("/api/ai/analysis")
      .send({ mineId: "gevra", allowExternal: true })
      .expect(200);
    assert.equal(review.body.mode, "rules");
    const status = (await user.get("/api/integrations")).body;
    assert.equal(status.policy.allowExternal, false);
    assert.equal(status.configuredModels.text, true);
    assert.equal(status.models.text, false);
    assert.ok(!JSON.stringify(status).includes("fictional-test-credential"));
    assert.equal(calls, 0);
  } finally {
    db.close();
  }
});
test("private deployment activation enables only authenticated calls; disabling it immediately returns rules", async () => {
  configure();
  process.env.ADMIN_EMAIL = "test@example.in";
  process.env.ADMIN_PASSWORD = "TestPassword@2026";
  const dir = temp();
  const { app, db } = createApp({
    database: path.join(dir, "private.sqlite"),
    demo: false,
    embeddedPreview: false,
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "No mine evidence has been provided." } },
        ],
      }),
    };
  };
  try {
    await request(app)
      .post("/api/ai/chat")
      .send({ question: "Any evidence?" })
      .expect(401);
    assert.equal(calls, 0);
    const user = request.agent(app);
    await user
      .post("/api/auth/login")
      .send({ email: "test@example.in", password: "TestPassword@2026" })
      .expect(200);
    const result = await user
      .post("/api/ai/chat")
      .send({ question: "Any evidence?" })
      .expect(200);
    assert.equal(result.body.mode, "model");
    assert.equal(calls, 1);
    process.env.AI_ENABLED = "false";
    const disabled = await user
      .post("/api/ai/chat")
      .send({ question: "Any evidence?" })
      .expect(200);
    assert.equal(disabled.body.mode, "rules");
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});
test("provider transport rejects redirects instead of forwarding credentials to another destination", async () => {
  configure();
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, "error");
    return { ok: false, status: 302 };
  };
  await assert.rejects(
    () => chat(fakeDb(), "Question", [], [], [], [], aiPolicy(false)),
    /302/,
  );
});
test("adapter-level deployment guard also prevents calls if a caller incorrectly supplies allowExternal", async () => {
  configure();
  process.env.AI_ENABLED = "false";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Unexpected request");
  };
  await assert.rejects(
    () => chat(fakeDb(), "Question", [], [], [], [], { allowExternal: true }),
    /deployment policy/,
  );
  process.env.AI_ENABLED = "true";
  process.env.DEMO_MODE = "true";
  await assert.rejects(
    () => chat(fakeDb(), "Question", [], [], [], [], { allowExternal: true }),
    /deployment policy/,
  );
  assert.equal(calls, 0);
});
