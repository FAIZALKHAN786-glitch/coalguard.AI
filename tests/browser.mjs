import assert from "node:assert/strict";
import { chromium as playwright, expect } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/app.js";
const screenshotDir = process.env.SCREENSHOT_DIR || "test-results";
fs.mkdirSync(screenshotDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coalguard-browser-"));
const libraryDir = path.join(dir, "libraries");
fs.mkdirSync(libraryDir);
if (process.platform === "linux") {
  const archive = path.join(dir, "libs.tar");
  fs.writeFileSync(
    archive,
    zlib.brotliDecompressSync(
      fs.readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br"),
    ),
  );
  execFileSync("tar", ["xf", archive, "-C", libraryDir]);
}
const { app, db } = createApp({
  database: path.join(dir, "test.sqlite"),
  demo: true,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args,
  headless: true,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: `${libraryDir}/lib:${process.env.LD_LIBRARY_PATH || ""}`,
  },
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(screenshotDir, "desktop.png"),
    fullPage: true,
  });
  console.log("✓ Desktop dashboard renders with live aggregates");
  const peer = await context.newPage();
  await peer.goto(url + "/#inspection");
  await expect(
    peer.getByRole("heading", { name: "Inspections", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser-tested safety inspection");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("created successfully");
  await expect(
    peer.getByText("Browser-tested safety inspection", { exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await peer.close();
  console.log(
    "✓ Live event updates reach a second client without manual refresh",
  );
  await page.getByRole("button", { name: "Inspections", exact: true }).click();
  await expect(
    page.getByText("Browser-tested safety inspection", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Browser-tested safety inspection", { exact: true })
    .click();
  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("completed");
  await page
    .getByLabel("Inspection findings")
    .fill("Equipment checked. No deficiencies.");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("updated successfully");
  console.log("✓ Inspection create → detail → edit → persistence");
  await page.getByRole("button", { name: "Compliance", exact: true }).click();
  await page.getByLabel("Filter status").selectOption("overdue");
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await page.getByLabel("Search records").fill("not-existing-anywhere");
  await expect(page.getByText("No matching records")).toBeVisible();
  console.log("✓ Register search and status filters");
  await page.getByRole("button", { name: "Search anything…" }).click();
  await page.getByLabel("Search all records").fill("Browser-tested");
  await page
    .getByRole("button", { name: /Browser-tested safety inspection/ })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  console.log("✓ Global search opens persisted record");
  await page.goto(url + "/#intelligence");
  await expect(
    page.getByRole("heading", { name: "A step ahead. Never on autopilot." }),
  ).toBeVisible();
  await page
    .getByLabel("Ask the governance assistant")
    .fill("Which mine risks need attention?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByText(/The language model is not connected yet/),
  ).toBeVisible();
  console.log("✓ Unconfigured AI provides transparent rule-based output");
  await page.goto(url + "/#documents");
  await page.locator("input[type=file]").setInputFiles({
    name: "browser-evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Reviewed safety evidence for the inspection."),
  });
  await expect(
    page.getByRole("heading", { name: "browser-evidence.txt" }),
  ).toBeVisible();
  console.log("✓ Document upload and extraction");
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 950;
    c.height = 160;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "black";
    ctx.font = "bold 45px Arial";
    ctx.fillText("COALGUARD SAFETY INSPECTION", 30, 85);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "ocr-check.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect
    .poll(
      async () => {
        const docs = await page.request
          .get(url + "/api/documents")
          .then((r) => r.json());
        return docs.find((d) => d.name === "ocr-check.png")?.text || "";
      },
      { timeout: 60000, intervals: [1000, 2000, 3000] },
    )
    .toMatch(/SAFETY INSPECTION/i);
  console.log(
    "✓ Bundled image OCR extracts real text without external language downloads",
  );
  await page.goto(url + "/#field");
  await expect(
    page.getByRole("heading", { name: "Field workspace", exact: true }),
  ).toBeVisible();
  // Ensure service worker controls the page before testing a full offline reload.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Field workspace", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Field workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New field report", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Offline field report from browser test");
  await page.getByRole("button", { name: "Save offline", exact: true }).click();
  await expect(page.getByText("Queued on device")).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync reports", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("synced successfully");
  await expect(
    page.getByText("Offline field report from browser test", { exact: true }),
  ).toBeVisible();
  console.log(
    "✓ Offline reload → capture → IndexedDB queue → authenticated sync",
  );
  for (const route of [
    "mines",
    "contractor",
    "action",
    "operation",
    "environment",
    "attendance",
    "grievance",
    "reports",
    "audit",
    "settings",
  ]) {
    await page.goto(url + "/#" + route);
    await expect(page.locator("main h1")).toBeVisible();
    assert.ok(
      !(await page.getByText("Something interrupted your workspace.").count()),
    );
  }
  console.log("✓ All primary navigation destinations render");
  await page.goto(url + "/#audit");
  await page.getByRole("button", { name: "Verify audit chain" }).click();
  await expect(page.getByText(/Chain intact/)).toBeVisible();
  console.log("✓ Audit chain verification from UI");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + "/#dashboard");
  await expect(
    page.getByRole("heading", { name: "Governance overview" }),
  ).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile must not overflow horizontally",
  );
  await page.screenshot({
    path: path.join(screenshotDir, "mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Field workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Field workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New field report", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  await page.screenshot({
    path: path.join(screenshotDir, "mobile-form.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  console.log("✓ Responsive 390px layout, navigation, and mobile report form");
  assert.deepEqual(errors, []);
  console.log("✓ No browser runtime errors");
} catch (e) {
  await page.screenshot({
    path: path.join(screenshotDir, "error.png"),
    fullPage: true,
  });
  console.log(
    await page
      .locator("[role=dialog]")
      .innerText()
      .catch(() => page.locator("main").innerText()),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
