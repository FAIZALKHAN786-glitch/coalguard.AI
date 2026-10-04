import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  aiStatus,
  retrieve as retrieveImpl,
  chat as chatImpl,
  decision as decisionImpl,
} from "../server/ai.js";
const retrieve = (...args) => retrieveImpl(...args, { allowExternal: true });
const chat = (...args) => chatImpl(...args, { allowExternal: true });
const decision = (...args) => decisionImpl(...args, { allowExternal: true });
const originalFetch = globalThis.fetch;
const initialEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env).filter((k) => k.startsWith("AI_")))
    delete process.env[key];
  Object.assign(
    process.env,
    Object.fromEntries(
      Object.entries(initialEnv).filter(([k]) => k.startsWith("AI_")),
    ),
  );
});
function configure(type) {
  process.env.AI_ENABLED = "true";
  process.env.AI_ALLOWED_HOSTS = "provider.example";
  process.env[`AI_${type}_BASE_URL`] = "https://provider.example/v1";
  process.env[`AI_${type}_API_KEY`] = "test-only-not-a-secret";
  process.env[`AI_${type}_MODEL`] = "test-model";
}
function fakeDb() {
  const cache = new Map();
  return {
    prepare(sql) {
      return {
        get(id, model) {
          return cache.get(id + "|" + model);
        },
        run(id, model, vector) {
          cache.set(id + "|" + model, { vector });
        },
      };
    },
  };
}
const docs = [
  {
    id: "d1",
    name: "Air-quality.txt",
    text: "Dust monitoring requires review. Haul road dust reading increased.",
  },
  {
    id: "d2",
    name: "Worker-training.txt",
    text: "Training completed for all contractor workers.",
  },
];
test("keyword retrieval uses document evidence without provider calls", async () => {
  globalThis.fetch = () => {
    throw Error("Unexpected network call");
  };
  const result = await retrieve(fakeDb(), docs, "dust monitoring");
  assert.equal(result.method, "keyword");
  assert.equal(result.documents[0].id, "d1");
});
test("embedding and Cohere-compatible reranking adapters use expected payloads", async () => {
  configure("EMBEDDING");
  configure("RERANK");
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () =>
        String(url).endsWith("/rerank")
          ? { results: [{ index: 0, relevance_score: 0.97 }] }
          : {
              data: [
                {
                  embedding: JSON.parse(options.body).input.includes("Training")
                    ? [0, 1]
                    : [1, 0],
                },
              ],
            },
    };
  };
  const db = fakeDb();
  const result = await retrieve(db, docs, "dust");
  assert.equal(result.method, "embedding + reranking");
  assert.equal(result.documents[0].id, "d1");
  assert.ok(requests.some((r) => r.url.endsWith("/embeddings")));
  assert.equal(requests.at(-1).body.top_n, 4);
  requests.length = 0;
  await retrieve(db, docs, "dust");
  assert.equal(
    requests.filter((r) => r.url.endsWith("/embeddings")).length,
    1,
    "Document vectors should be cached",
  );
});
test("partial embedding failure preserves full keyword fallback", async () => {
  configure("EMBEDDING");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls > 1) throw Error("Provider unavailable");
    return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
  };
  const result = await retrieve(fakeDb(), docs, "dust");
  assert.equal(result.documents[0].id, "d1");
  assert.equal(result.method, "keyword");
  assert.match(result.warning, /keyword retrieval/);
});
test("text adapter returns real provider content and marks it model-generated", async () => {
  configure("TEXT");
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Review the reported dust increase [Air-quality.txt].",
            },
          },
        ],
      }),
    };
  };
  const result = await chat(fakeDb(), "What about dust?", [], [], docs, []);
  assert.equal(result.mode, "model");
  assert.match(result.answer, /Review the reported/);
  assert.match(sent.messages[0].content, /untrusted/);
  assert.match(sent.messages[1].content, /Dust monitoring/);
  assert.equal(result.sources[0].id, "d1");
  assert.ok(aiStatus().text);
});
test("decision adapter validates structured recommendations", async () => {
  configure("DECISION");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Review evidence.",
              recommendations: [
                {
                  title: "Air quality",
                  rationale: "Reported increase",
                  nextStep: "Verify sample",
                },
              ],
            }),
          },
        },
      ],
    }),
  });
  const result = await decision([]);
  assert.equal(result.mode, "model");
  assert.equal(result.recommendations[0].nextStep, "Verify sample");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"summary":42}' } }],
    }),
  });
  await assert.rejects(() => decision([]));
});
test("provider transport must use HTTPS and non-OK responses fail", async () => {
  configure("TEXT");
  process.env.AI_TEXT_BASE_URL = "http://provider.example";
  await assert.rejects(() => chat(fakeDb(), "query", [], [], [], []), /HTTPS/);
  process.env.AI_TEXT_BASE_URL = "https://provider.example";
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => chat(fakeDb(), "query", [], [], [], []), /503/);
});
