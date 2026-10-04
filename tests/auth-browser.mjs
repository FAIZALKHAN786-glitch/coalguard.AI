import assert from "node:assert/strict";
import { chromium as playwright, expect } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/app.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-auth-"));
const libraries = path.join(dir, "libs");
fs.mkdirSync(libraries);
const archive = path.join(dir, "libs.tar");
fs.writeFileSync(
  archive,
  zlib.brotliDecompressSync(
    fs.readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br"),
  ),
);
execFileSync("tar", ["xf", archive, "-C", libraries]);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    path.join(dir, "key.pem"),
    "-out",
    path.join(dir, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const { app, db } = createApp({
  database: path.join(dir, "db.sqlite"),
  demo: true,
  embeddedPreview: true,
});
const server = https
  .createServer(
    {
      key: fs.readFileSync(path.join(dir, "key.pem")),
      cert: fs.readFileSync(path.join(dir, "cert.pem")),
    },
    app,
  )
  .listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `https://127.0.0.1:${server.address().port}`;
const parent = http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<html><body><iframe src="${url}" style="width:1200px;height:900px"></iframe></body></html>`,
    );
  })
  .listen(0, "127.0.0.1");
await new Promise((resolve) => parent.once("listening", resolve));
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args.filter(
      (a) =>
        !a.includes("disable-web-security") &&
        !a.includes("allow-running-insecure-content"),
    ),
    "--test-third-party-cookie-phaseout",
  ],
  headless: true,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: `${libraries}/lib:${process.env.LD_LIBRARY_PATH || ""}`,
  },
});
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${parent.address().port}`);
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible({ timeout: 15000 });
  const cookies = await context.cookies();
  const cookie = cookies.find(
    (c) => c.name === "__Host-coalguard_preview_session",
  );
  assert.ok(
    cookie?.partitionKey,
    "Embedded session should be partitioned by top-level site",
  );
  assert.equal(cookie.sameSite, "None");
  assert.ok(cookie.secure && cookie.httpOnly);
  console.log(
    "✓ Embedded cross-site preview signs in with a secure partitioned cookie",
  );
  await page.reload();
  await expect(
    frame.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  console.log("✓ Embedded session survives reload");
  db.prepare("DELETE FROM sessions").run();
  const child = page.frames().find((f) => f.url().startsWith(url));
  await child.evaluate(() => window.dispatchEvent(new Event("cg-refresh")));
  await expect(
    frame.getByRole("heading", { name: "Welcome to CoalGuard." }),
  ).toBeVisible();
  await expect(
    frame.getByText(
      "Your session expired or is unavailable. Sign in below to continue.",
    ),
  ).toBeVisible();
  await expect(
    frame.getByRole("button", { name: "Enter demo workspace" }),
  ).toBeVisible();
  console.log(
    "✓ Expired session opens the sign-in screen instead of a dead-end dashboard",
  );
  await frame.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    frame.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  console.log("✓ Demo sign-in restores the workspace");
  await frame.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "Welcome to CoalGuard." }),
  ).toBeVisible();
  await frame.getByLabel("Work email").fill("admin@coalguard.demo");
  await frame.getByLabel("Password", { exact: true }).fill("CoalGuard@2026");
  await frame.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  console.log("✓ Password sign-in and sign-out work in the iframe");
  await page.close();
  await context.clearCookies();
  const blocked = context;
  await blocked.route("**/api/auth/demo", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["set-cookie"];
    await blocked.clearCookies();
    await route.fulfill({ response, headers });
  });
  // Reject browser storage as well: online sign-in must not depend on it.
  await blocked.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
  });
  let sawPreviewHeader = false;
  // Simulate a gateway that reserves Authorization. Keep the signed session
  // in an application-specific header, not a URL, cookie, or browser storage.
  await blocked.route("**/api/**", async (route) => {
    const headers = { ...route.request().headers() };
    if (headers["x-coalguard-session"]) sawPreviewHeader = true;
    delete headers.authorization;
    await route.fallback({ headers });
  });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(url);
  await expect(
    blockedPage.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(
    (await blocked.cookies()).filter((c) => c.name.includes("coalguard"))
      .length,
    0,
  );
  await expect(
    blockedPage.getByText("Please sign in to continue", { exact: true }),
  ).toHaveCount(0);
  assert.ok(
    sawPreviewHeader,
    "Demo fallback must use the application-specific session header",
  );
  console.log(
    "✓ Demo loads with cookies/storage blocked and Authorization stripped",
  );
  const downloadPromise = blockedPage.waitForEvent("download");
  await blockedPage
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await blockedPage
    .getByRole("button", { name: "Export CSV", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  console.log("✓ Authenticated exports work without session cookies");
  await blockedPage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    blockedPage.getByRole("heading", { name: "Welcome to CoalGuard." }),
  ).toBeVisible();
  await blockedPage
    .getByRole("button", { name: "Enter demo workspace" })
    .click();
  await blockedPage
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    blockedPage.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  console.log("✓ Enter demo workspace succeeds with cookies/storage disabled");
  db.prepare("DELETE FROM sessions").run();
  await blockedPage.evaluate(() =>
    window.dispatchEvent(new Event("cg-refresh")),
  );
  await expect(
    blockedPage.getByRole("heading", { name: "Welcome to CoalGuard." }),
  ).toBeVisible();
  console.log(
    "✓ Memory fallback expiry still requires a new authenticated session",
  );
  await blocked.unroute("**/api/auth/demo");
  await blocked.route("**/api/auth/demo", (route) =>
    route.fulfill({
      status: 403,
      contentType: "text/html",
      body: "<h1>Preview access denied</h1>",
    }),
  );
  await blockedPage
    .getByRole("button", { name: "Enter demo workspace" })
    .click();
  await expect(blockedPage.getByRole("alert")).toContainText(
    "preview did not return an API response",
  );
  await expect(
    blockedPage.getByRole("button", { name: "Enter demo workspace" }),
  ).toBeEnabled();
  console.log(
    "✓ Non-JSON proxy failures show an actionable error instead of stopping silently",
  );
  await blocked.close();
} finally {
  await browser.close();
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => parent.close(resolve)),
  ]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
