import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../server/app.js";

test("Helmet allows the OSM tile host and sends the required referrer policy", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-osm-"));
  let db;
  process.env.NODE_ENV = "production";

  try {
    const instance = createApp({
      database: path.join(directory, "test.sqlite"),
      uploads: path.join(directory, "uploads"),
      demo: true,
    });
    db = instance.db;

    const response = await request(instance.app).get("/api/health").expect(200);
    assert.equal(
      response.headers["referrer-policy"],
      "strict-origin-when-cross-origin",
    );

    const imageSources = response.headers["content-security-policy"]
      .split(";")
      .find((directive) => directive.trimStart().startsWith("img-src "));
    assert.ok(imageSources, "CSP should contain an img-src directive");
    assert.ok(imageSources.includes("https://tile.openstreetmap.org"));
    assert.ok(!imageSources.includes("https://*.tile.openstreetmap.org"));
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
