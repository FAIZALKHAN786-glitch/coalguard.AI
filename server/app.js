import express from "express";
import { EventEmitter } from "node:events";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import multer from "multer";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  openDatabase,
  schemaVersion,
  uuid,
  now,
  audit,
  verifyAudit,
  record,
  transaction,
} from "./db-adapter.js";
import { seed } from "./seed.js";
import {
  statuses,
  recordSchema,
  loginSchema,
  userSchema,
  mineSchema,
} from "./schemas.js";
import { dashboard, notifications, insights } from "./analytics.js";
import { aiStatus, chat, decision } from "./ai.js";
import { aiPolicy } from "./ai-security.js";
const fail = (status, message) => Object.assign(new Error(message), { status });

// Bounded list endpoints. Analytical reads (dashboard, notifications, exports)
// share a higher ceiling so no single request can pull an unbounded table.
export const LIST_LIMIT_DEFAULT = 500;
export const LIST_LIMIT_MAX = 2000;
export const ANALYTICS_LIMIT_MAX = 20000;
export const EXPORT_LIMIT_MAX = 10000;
export const DOCUMENT_LIST_LIMIT = 200;
// The reminder surface is a short list, not an export. Measured at 50,000
// records the uncapped array reached 2 MB per poll.
export const NOTIFICATION_LIMIT = 200;

export function pageParams(
  query = {},
  fallback = LIST_LIMIT_DEFAULT,
  max = LIST_LIMIT_MAX,
) {
  const parse = (value, def) => {
    if (value === undefined || value === "") return def;
    if (!/^\d{1,7}$/.test(String(value)))
      throw fail(400, "limit and offset must be whole numbers");
    return Number(value);
  };
  const limit = parse(query.limit, fallback);
  const offset = parse(query.offset, 0);
  if (limit < 1 || limit > max)
    throw fail(400, `limit must be between 1 and ${max}`);
  return { limit, offset };
}

// Trusted reverse-proxy configuration. The default trusts only a proxy on the
// same host ("loopback"), so forwarded headers from any other source are
// ignored. A service reachable directly from the internet therefore cannot be
// made to believe a forged X-Forwarded-For, which is what rate-limit keys are
// derived from when a request is unauthenticated.
export function parseTrustProxy(value) {
  const setting = String(value ?? "loopback").trim();
  if (setting === "" || setting === "false") return false;
  if (setting === "true")
    throw new Error(
      "TRUST_PROXY=true is refused: trusting every forwarder lets any client forge its own address. Trust a named range or an explicit hop count instead.",
    );
  if (/^[1-5]$/.test(setting)) return Number(setting);
  if (["loopback", "linklocal", "uniquelocal"].includes(setting)) return setting;
  const list = setting
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const cidr = (entry) =>
    /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(entry) ||
    /^[0-9a-fA-F:]+\/\d{1,3}$/.test(entry);
  if (list.length && list.every(cidr)) return list;
  throw new Error(
    "TRUST_PROXY must be false, a hop count (1-5), loopback, linklocal, uniquelocal, or a comma-separated CIDR list of your proxy addresses.",
  );
}
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  mines: JSON.parse(u.mines),
});
export async function createApp({
  database = process.env.DATABASE_PATH || "./data/coalguard.sqlite",
  demo = process.env.DEMO_MODE === "true" ||
    (process.env.DEMO_MODE === undefined &&
      process.env.NODE_ENV !== "production"),
  uploads,
  embeddedPreview = process.env.EMBEDDED_PREVIEW === "true",
  publicOrigin = process.env.APP_ORIGIN,
  trustProxy: trustProxySetting = process.env.TRUST_PROXY,
} = {}) {
  if (embeddedPreview && !demo)
    throw new Error(
      "Embedded preview cookies are restricted to demonstration workspaces.",
    );
  const trustedOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
  const cookieName = embeddedPreview
    ? "__Host-coalguard_preview_session"
    : "coalguard_session";
  const cookieOptions = {
    httpOnly: true,
    sameSite: embeddedPreview ? "none" : "lax",
    secure: embeddedPreview || process.env.COOKIE_SECURE === "true",
    ...(embeddedPreview ? { partitioned: true } : {}),
    path: "/",
  };
  // A demonstration deployment may be embedded in a preview workspace. A real
  // deployment is framed by nothing except hosts the operator names explicitly.
  const embeddingOrigins =
    demo || embeddedPreview
      ? [
          "https://*.arena.ai",
          "https://arena.ai",
          "https://*.e2b.app",
          ...(embeddedPreview ? ["https://*.arena.site"] : []),
        ]
      : [];
  const frameAncestors = [
    "'self'",
    ...embeddingOrigins,
    ...(process.env.FRAME_ANCESTORS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ];
  if (
    !demo &&
    !embeddedPreview &&
    cookieOptions.secure !== true
  ) {
    if (trustedOrigin?.startsWith("https:"))
      throw new Error(
        "APP_ORIGIN is an HTTPS address but COOKIE_SECURE is not true. Sessions would be issued without the Secure attribute.",
      );
    console.warn(
      "[coalguard] COOKIE_SECURE is not true: session cookies will not carry the Secure attribute. Terminate TLS at your reverse proxy and set COOKIE_SECURE=true before exposing this deployment.",
    );
  }
  const db = openDatabase(database);
  if (!demo && await db.prepare("SELECT id FROM users WHERE id='u-admin'").get()) {
    await db.close();
    throw new Error(
      "Production cannot use a demonstration database. Configure a new DATABASE_PATH.",
    );
  }
  seed(db, demo);
  const uploadDir =
    uploads ||
    path.resolve(
      path.dirname(database === ":memory:" ? "./data/test.sqlite" : database),
      "uploads",
    );
  fs.mkdirSync(uploadDir, { recursive: true });
  await db.prepare(
    "UPDATE documents SET status='failed' WHERE status='processing'",
  ).run();
  const app = express();
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const trustProxy = parseTrustProxy(trustProxySetting);
  app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  console.info(
    `[coalguard] TRUST_PROXY resolved to ${JSON.stringify(trustProxy)}; rate limits and client addresses follow this setting.`,
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://tile.openstreetmap.org",
          ],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          frameAncestors,
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );
  // Arena preview embeds the application; production deployments may set stricter frame-ancestors at their reverse proxy.
  app.use(async (req, res, next) => {
    res.removeHeader("X-Frame-Options");
    if (process.env.NODE_ENV !== "production")
      res.removeHeader("Content-Security-Policy");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      demo &&
      process.env.AUTH_DIAGNOSTICS === "true" &&
      [
        "/auth/demo",
        "/auth/login",
        "/auth/me",
        "/dashboard",
        "/config",
      ].includes(req.path)
    ) {
      const requestId = uuid().slice(0, 8);
      res.set("X-CoalGuard-Request-Id", requestId);
      res.once("finish", () =>
        console.info(
          "[preview-auth]",
          JSON.stringify({
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            cookiePresent: Boolean(req.cookies[cookieName]),
            authorizationPresent: Boolean(req.get("authorization")),
            authorizationLooksLikeSession: /^Bearer [a-f0-9]{64}$/.test(
              req.get("authorization") || "",
            ),
            previewHeaderPresent: Boolean(req.get("x-coalguard-session")),
            requestedMemory: req.body?.sessionTransport === "memory",
            host: req.get("host"),
            origin: req.get("origin") || null,
          }),
        ),
      );
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        origin &&
        (() => {
          try {
            const incoming = new URL(origin);
            return (
              incoming.origin !== trustedOrigin &&
              incoming.host !== req.get("host")
            );
          } catch {
            return true;
          }
        })()
      )
        return res.status(403).json({ error: "Cross-origin request denied" });
      if (req.get("sec-fetch-site") === "cross-site")
        return res.status(403).json({ error: "Cross-site request denied" });
    }
    next();
  });
  // Two layers: a per-account (or per-address when signed out) fair-use limit,
  // and a process-wide ceiling that keeps one caller from consuming the whole
  // service. Neither replaces a provider-side spend cap or an edge limiter.
  const identity = (req) =>
    createHash("sha256")
      .update(
        req.cookies?.[cookieName] ||
          req.get("authorization") ||
          req.get("x-coalguard-session") ||
          req.ip ||
          "anonymous",
      )
      .digest("hex");
  const apiLimit = rateLimit({
    windowMs: 60000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: identity,
    skip: (req) => ["/health", "/ready", "/events"].includes(req.path),
    message: { error: "Too many requests. Please slow down and try again." },
  });
  const globalLimit = rateLimit({
    windowMs: 60000,
    limit: 1200,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: () => "all-requests",
    skip: (req) => ["/health", "/ready", "/events"].includes(req.path),
    message: { error: "The service is busy. Please retry in a moment." },
  });
  app.use("/api", apiLimit, globalLimit);
  app.get("/api/health", async (req, res) => { res.json({ ok: true }); });
  app.get("/api/ready", async (req, res) => {
    try {
      const actual = (await db.prepare("PRAGMA user_version").get()).user_version;
      const expected = schemaVersion();
      if (actual !== expected)
        throw new Error(`schema version ${actual} is not ${expected}`);
      await db.prepare("SELECT 1 AS ok").get();
      res.json({ ready: true, schemaVersion: actual });
    } catch {
      // Readiness must not disclose paths, credentials or driver detail.
      res.status(503).json({ ready: false });
    }
  });
  app.get("/api/config", async (req, res) =>
    res.json({ demo, embeddedPreview, version: "1.0.0" }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  });
  const sessionKey = (token) =>
    createHash("sha256").update(token).digest("hex");
  async function session (res, u, memory = false) {
    const token = randomBytes(32).toString("hex");
    await db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    await db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      sessionKey(token),
      u.id,
      Date.now() + (memory ? 3600000 : 12 * 3600000),
    );
    res.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: 12 * 3600000,
    });
    return memory ? token : undefined;
  }
  function memoryRequested(req) {
    const memory = req.body?.sessionTransport === "memory";
    if (memory && !(demo && embeddedPreview))
      throw fail(
        400,
        "Cookie-free sessions are only available in embedded demonstration workspaces.",
      );
    return memory;
  }
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const memory = memoryRequested(req);
    const { email, password } = loginSchema.parse(req.body);
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.toLowerCase());
    const good = await bcrypt.compare(
      password,
      u?.password ||
        "$2b$12$JpkLTWpHPG2m1igbsNjp/uLCnsASAAW2AJkXCCX6jZVBbZUtHYiS2",
    );
    if (!u || !good) throw fail(401, "Incorrect email or password");
    const accessToken = await session(res, u, memory);
    await audit(db, u, "signed_in", "session", null);
    res.json({
      user: safeUser(u),
      ...(memory ? { accessToken, transport: "memory" } : {}),
    });
  });
  app.post("/api/auth/demo", authLimit, async (req, res) => {
    if (!demo) throw fail(404, "Demo access is disabled");
    const u = await db.prepare("SELECT * FROM users WHERE id='u-admin'").get();
    if (!u) throw fail(404, "Demo workspace is unavailable");
    const memory = memoryRequested(req);
    const accessToken = await session(res, u, memory);
    res.json({
      user: safeUser(u),
      ...(memory ? { accessToken, transport: "memory" } : {}),
    });
  });
  app.use("/api", async (req, res, next) => {
    const bearer =
      demo &&
      embeddedPreview &&
      req.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    // Some embedding gateways reserve/replace Authorization and strip app
    // cookies. This same-origin application header is demo-preview-only.
    const previewToken =
      demo &&
      embeddedPreview &&
      req.get("x-coalguard-session")?.match(/^[a-f0-9]{64}$/)?.[0];
    const token = previewToken || bearer || req.cookies[cookieName];
    const u = token && (await db.prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        ).get(sessionKey(token), Date.now()));
    if (!u)
      return      return res.status(401).json({ error: "Please sign in to continue" });
    req.user = safeUser(u);
    req.sessionTokenHash = sessionKey(token);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      res.once("finish", () => {
        if (res.statusCode < 300) events.emit("change");
      });
    next();
  });
  // Portfolio visibility is a property of the role, never of an empty
  // assignment list. A field or officer account whose mine list is empty must
  // not silently gain access to every site.
  const portfolioRoles = ["admin", "regulator"];
  const mineAccess = (u, id) =>
    portfolioRoles.includes(u.role)
      ? u.mines.length === 0 || u.mines.includes(id)
      : u.mines.includes(id);
  async function requireMine (u, id) {
    if (!(await db.prepare("SELECT id FROM mines WHERE id=?").get(id)))
      throw fail(404, "Mine not found");
    if (!mineAccess(u, id))
      throw fail(403, "This mine is outside your assigned access");
  }
  function requireRole(u, roles) {
    if (!roles.includes(u.role))
      throw fail(403, "Your role does not permit this action");
  }
  const placeholders = (n) => Array(n).fill("?").join(",");
  async function scopedMineIds (u, filter) {
    if (filter && filter !== "all") {
      await requireMine(u, filter);
      return [filter];
    }
    const rows = await db.prepare("SELECT id FROM mines ORDER BY id").all();
    return rows.map((m) => m.id).filter((id) => mineAccess(u, id));
  }
  async function scopedMines (u, filter) {
    const ids = await scopedMineIds(u, filter);
    if (!ids.length) return [];
    return (await db.prepare(
      `SELECT * FROM mines WHERE id IN (${placeholders(ids.length)}) ORDER BY name`,
    ).all(...ids));
  }
  // Mine scope, record kind, status, search text and ordering are pushed into
  // SQL with a bound row limit: a request never reads a whole table to filter
  // it in memory, and the result size is deterministic.
  async function recordFilter (u, filter, { kind, status, q } = {}) {
    const ids = await scopedMineIds(u, filter);
    if (!ids.length) return null;
    const where = [`mine_id IN (${placeholders(ids.length)})`];
    const params = [...ids];
    if (kind) {
      where.push("kind=?");
      params.push(kind);
    }
    if (status) {
      where.push("status=?");
      params.push(status);
    }
    if (q) {
      where.push(
        "instr(lower(title||' '||owner||' '||category||' '||notes),?)>0",
      );
      params.push(String(q).toLowerCase());
    }
    return { clause: where.join(" AND "), params };
  }
  async function countRecords (u, filter, options = {}) {
    const built = await recordFilter(u, filter, options);
    if (!built) return 0;
    return (await db.prepare(`SELECT count(*) n FROM records WHERE ${built.clause}`)
      .get(...built.params)).n;
  }
  async function scopedRecords (u, filter, options = {}) {
    const built = await recordFilter(u, filter, options);
    if (!built) return [];
    const limit = Math.min(
      Number(options.limit) || ANALYTICS_LIMIT_MAX,
      ANALYTICS_LIMIT_MAX,
    );
    const offset = Math.max(Number(options.offset) || 0, 0);
    return (await db.prepare(
      `SELECT * FROM records WHERE ${built.clause} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`,
    ).all(...built.params, limit, offset)).map(record);
  }
  function canWrite(u, kind) {
    requireRole(u, [
      "admin",
      "officer",
      ...(["field", "attendance", "grievance"].includes(kind) ? ["field"] : []),
    ]);
  }
  app.get("/api/events", async (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    const changed = () => res.write("event: change\ndata: {}\n\n");
    events.on("change", changed);
    const heartbeat = setInterval(async () => {
      const valid = await db.prepare("SELECT token FROM sessions WHERE token=? AND expires>?").get(req.sessionTokenHash, Date.now());
      if (!valid) {
        res.write("event: expired\ndata: {}\n\n");
        res.end();
        return;
      }
      res.write(": heartbeat\n\n");
    }, 25000);
    res.on("close", () => {
      clearInterval(heartbeat);
      events.off("change", changed);
    });
  });
  app.get("/api/auth/me", async (req, res) => { res.json({ user: req.user }); });
  app.post("/api/auth/logout", async (req, res) => {
    await db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionTokenHash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    for (const key of [
      "mine",
      "q",
      "status",
      "kind",
      "from",
      "to",
      "limit",
      "offset",
    ])
      if (
        req.query[key] !== undefined &&
        (typeof req.query[key] !== "string" || req.query[key].length > 500)
      )
        return res.status(400).json({ error: "Invalid query parameter" });
    next();
  });
  app.get("/api/mines", async (req, res) => res.json(await scopedMines(req.user)));
  app.post("/api/mines", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const m = mineSchema.parse(req.body);
    const id = uuid();
    await transaction(db, async () => {
      await db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run(
        id,
        m.name,
        m.subsidiary,
        m.region,
        m.latitude,
        m.longitude,
        m.capacity,
      );
      await audit(db, req.user, "created", "mine", id, m);
    });
    res.status(201).json({ id, ...m });
  });
  app.get("/api/dashboard", async (req, res) => {
    const mines = await scopedMines(req.user, req.query.mine);
    const rows = await scopedRecords(req.user, req.query.mine);
    // The analytical scan is capped; the flag keeps truncation visible instead
    // of silently reporting partial aggregates.
    const total = await countRecords(req.user, req.query.mine);
    res.json({
      ...dashboard(rows, mines),
      updatedAt: now(),
      scannedRecords: rows.length,
      totalRecords: total,
      truncated: total > rows.length,
    });
  });
  app.get("/api/records/:kind", async (req, res) => {
    if (!statuses[req.params.kind]) throw fail(404, "Unknown record type");
    const kind = req.params.kind;
    if (req.query.status && !statuses[kind].includes(req.query.status))
      throw fail(400, "Unknown status filter for this record type");
    const { limit, offset } = pageParams(req.query);
    const options = {
      kind,
      status: req.query.status,
      q: req.query.q,
      limit,
      offset,
    };
    const total = await countRecords(req.user, req.query.mine, options);
    const rows = await scopedRecords(req.user, req.query.mine, options);
    res.set("X-Total-Count", String(total));
    res.set("X-Result-Limit", String(limit));
    res.json(rows);
  });
  app.post("/api/records/:kind", async (req, res) => {
    const { kind } = req.params;
    if (!statuses[kind]) throw fail(404, "Unknown record type");
    canWrite(req.user, kind);
    const r = recordSchema(kind).parse(req.body);
    await requireMine(req.user, r.mineId);
    if (
      kind === "compliance" &&
      r.status === "compliant" &&
      req.user.role !== "admin"
    )
      throw fail(403, "Only administrators can approve compliance");
    if (kind === "compliance" && r.status === "compliant" && !r.notes.trim())
      throw fail(400, "Approval requires a review note or evidence reference");
    if (r.data.documentId) {
      const d = db
        .prepare("SELECT mine_id FROM documents WHERE id=?")
        .get(r.data.documentId);
      if (!d || d.mine_id !== r.mineId)
        throw fail(400, "Evidence document must belong to the same mine");
    }
    if (r.data.sourceId) {
      const source = db
        .prepare("SELECT mine_id FROM records WHERE id=?")
        .get(r.data.sourceId);
      if (!source || source.mine_id !== r.mineId)
        throw fail(400, "Source record must belong to the same mine");
    }
    const key = req.get("Idempotency-Key");
    if (key && key.length > 100) throw fail(400, "Idempotency key is too long");
    const id = uuid(),
      time = now();
    let replayId = null;
    await transaction(db, async () => {
      // The receipt is claimed inside the same transaction as the insert, so
      // BEGIN IMMEDIATE serializes simultaneous replays of one offline report:
      // the second request returns the first record and writes no second audit
      // entry.
      if (key) {
        const existing = db
          .prepare("SELECT record_id FROM idempotency WHERE user_id=? AND key=?")
          .get(req.user.id, key);
        if (existing) {
          replayId = existing.record_id;
          return;
        }
      }
      await db.prepare(
        "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        kind,
        r.mineId,
        r.title,
        r.category,
        r.status,
        r.priority,
        r.dueDate || null,
        r.owner,
        r.notes,
        JSON.stringify(r.data),
        req.user.id,
        time,
        time,
      );
      await audit(db, req.user, "created", `${kind}:${id}`, r.mineId, r);
      if (key)
        await db.prepare("INSERT INTO idempotency VALUES(?,?,?)").run(
          req.user.id,
          key,
          id,
        );
    });
    if (replayId) {
      const existing = record(
        await db.prepare("SELECT * FROM records WHERE id=?").get(replayId),
      );
      if (!existing)
        throw fail(409, "Previously submitted record was removed");
      return res.json(existing);
    }
    res
      .status(201)
      .json(record(await db.prepare("SELECT * FROM records WHERE id=?").get(id)));
  });
  app.patch("/api/records/:kind/:id", async (req, res) => {
    const { kind, id } = req.params;
    if (!statuses[kind]) throw fail(404, "Unknown record type");
    canWrite(req.user, kind);
    const before = record(
      await db.prepare("SELECT * FROM records WHERE id=? AND kind=?").get(id, kind),
    );
    if (!before) throw fail(404, "Record not found");
    await requireMine(req.user, before.mineId);
    const r = recordSchema(kind).parse(req.body);
    await requireMine(req.user, r.mineId);
    if (r.version !== before.version)
      throw fail(
        409,
        "This record was updated by someone else. Refresh before saving.",
      );
    if (
      kind === "compliance" &&
      r.status === "compliant" &&
      req.user.role !== "admin"
    )
      throw fail(403, "Only administrators can approve compliance");
    if (kind === "compliance" && r.status === "compliant" && !r.notes.trim())
      throw fail(400, "Approval requires a review note or evidence reference");
    if (r.data.documentId) {
      const d = db
        .prepare("SELECT mine_id FROM documents WHERE id=?")
        .get(r.data.documentId);
      if (!d || d.mine_id !== r.mineId)
        throw fail(400, "Evidence document must belong to the same mine");
    }
    if (r.data.sourceId) {
      const s = db
        .prepare("SELECT mine_id FROM records WHERE id=?")
        .get(r.data.sourceId);
      if (!s || s.mine_id !== r.mineId)
        throw fail(400, "Source record must belong to the same mine");
    }
    await transaction(db, async () => {
      await db.prepare(
        "UPDATE records SET mine_id=?,title=?,category=?,status=?,priority=?,due_date=?,owner=?,notes=?,data=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(
        r.mineId,
        r.title,
        r.category,
        r.status,
        r.priority,
        r.dueDate || null,
        r.owner,
        r.notes,
        JSON.stringify(r.data),
        now(),
        id,
      );
      audit(
        db,
        req.user,
        r.status === "compliant" && before.status !== "compliant"
          ? "approved"
          : "updated",
        `${kind}:${id}`,
        r.mineId,
        { before, after: r },
      );
    });
    res.json(record(await db.prepare("SELECT * FROM records WHERE id=?").get(id)));
  });
  app.delete("/api/records/:kind/:id", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const row = record(
      db
        .prepare("SELECT * FROM records WHERE id=? AND kind=?")
        .get(req.params.id, req.params.kind),
    );
    if (!row) throw fail(404, "Record not found");
    await requireMine(req.user, row.mineId);
    await transaction(db, async () => {
      await db.prepare("DELETE FROM records WHERE id=?").run(row.id);
      await audit(db, req.user, "deleted", `${row.kind}:${row.id}`, row.mineId, row);
    });
    res.json({ ok: true });
  });
  app.get("/api/notifications", async (req, res) => {
    const read = new Set(
      db
        .prepare(
          "SELECT notification_id FROM read_notifications WHERE user_id=?",
        )
        .all(req.user.id)
        .map((r) => r.notification_id),
    );
    const all = notifications(await scopedRecords(req.user, req.query.mine));
    // Already ordered by due date, so truncation keeps the most urgent items.
    const visible = all.slice(0, NOTIFICATION_LIMIT);
    res.set("X-Total-Count", String(all.length));
    res.json(
      visible.map((n) => ({ ...n, read: read.has(n.id) })),
    );
  });
  app.post("/api/notifications/read", async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.string().max(200)).max(2000) })
      .parse(req.body);
    const allowed = new Set(
      notifications(await scopedRecords(req.user, "all")).map((n) => n.id),
    );
    await transaction(db, async () => {
      for (const id of ids)
        if (allowed.has(id))
          await db.prepare(
            "INSERT OR IGNORE INTO read_notifications VALUES(?,?)",
          ).run(req.user.id, id);
    });
    res.json({ ok: true });
  });
  app.get("/api/audit", async (req, res) => {
    const { limit, offset } = pageParams(req.query, 500, LIST_LIMIT_MAX);
    const ids = await scopedMineIds(req.user, req.query.mine);
    const where = [];
    const params = [];
    if (req.user.role === "admin") {
      // Portfolio administrators also see workspace-level (mine-less) entries.
      if (ids.length) {
        where.push(`(mine_id IS NULL OR mine_id IN (${placeholders(ids.length)}))`);
        params.push(...ids);
      } else {
        where.push("mine_id IS NULL");
      }
    } else if (ids.length) {
      where.push(`mine_id IN (${placeholders(ids.length)})`);
      params.push(...ids);
    } else {
      res.set("X-Total-Count", "0");
      return res.json([]);
    }
    const clause = where.join(" AND ");
    res.set(
      "X-Total-Count",
      String(
        await db.prepare(`SELECT count(*) n FROM audit WHERE ${clause}`).get(...params)
          .n,
      ),
    );
    res.json(
      db
        .prepare(
          `SELECT * FROM audit WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset),
    );
  });
  app.get("/api/audit/verify", async (req, res) => {
    requireRole(req.user, ["admin", "regulator"]);
    res.json(await verifyAudit(db));
  });
  app.get("/api/users", async (req, res) => {
    requireRole(req.user, ["admin"]);
    res.json(
      (await db.prepare("SELECT * FROM users ORDER BY name").all()).map(safeUser),
    );
  });
  app.post("/api/users", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const u = userSchema.parse(req.body);
    for (const id of u.mines) await requireMine(req.user, id);
    if (["officer", "field"].includes(u.role) && !u.mines.length)
      throw fail(400, "Assign at least one mine to field staff and officers");
    if (
      db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(u.email.toLowerCase())
    )
      throw fail(409, "Email is already registered");
    const id = uuid();
    const password = await bcrypt.hash(u.password, 12);
    await transaction(db, async () => {
      await db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
        id,
        u.name,
        u.email.toLowerCase(),
        password,
        u.role,
        JSON.stringify(u.mines),
      );
      await audit(db, req.user, "created", "user", null, {
        id,
        name: u.name,
        role: u.role,
        mines: u.mines,
      });
    });
    res.status(201).json({
      id,
      name: u.name,
      email: u.email.toLowerCase(),
      role: u.role,
      mines: u.mines,
    });
  });
  app.get("/api/integrations", async (req, res) => {
    const configuredModels = aiStatus(),
      policy = aiPolicy(demo);
    res.json({
      models: Object.fromEntries(
        Object.entries(configuredModels).map(([type, configured]) => [
          type,
          configured && policy.allowExternal,
        ]),
      ),
      configuredModels,
      policy,
      demo,
      ocr: true,
      audit: "SHA-256 linked entries",
      storage: "SQLite + private filesystem",
    });
  });
  const uploadLimit = rateLimit({
    windowMs: 600000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Upload limit reached. Try again in ten minutes." },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  const publicDoc = (d) => {
    const { storage_name, created_by, ...safe } = d;
    return safe;
  };
  // Extracted text reaches 250 kB per document, so the list returns metadata
  // only and never ships the private extraction of every stored file at once.
  const listDoc = (d) => {
    const { text, storage_name, created_by, ...safe } = d;
    return { ...safe, textLength: text.length };
  };
  app.get("/api/documents", async (req, res) => {
    const ids = await scopedMineIds(req.user, req.query.mine);
    const { limit, offset } = pageParams(
      req.query,
      DOCUMENT_LIST_LIMIT,
      LIST_LIMIT_MAX,
    );
    if (!ids.length) {
      res.set("X-Total-Count", "0");
      return res.json([]);
    }
    const clause = `mine_id IN (${placeholders(ids.length)})`;
    res.set(
      "X-Total-Count",
      String(
        db
          .prepare(`SELECT count(*) n FROM documents WHERE ${clause}`)
          .get(...ids).n,
      ),
    );
    res.json(
      db
        .prepare(
          `SELECT * FROM documents WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...ids, limit, offset)
        .map(listDoc),
    );
  });
  app.get("/api/documents/:id", async (req, res) => {
    const d = db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(req.params.id);
    if (!d) throw fail(404, "Document not found");
    await requireMine(req.user, d.mine_id);
    res.json(publicDoc(d));
  });
  let ocrTail = Promise.resolve();
  const MAX_PENDING_EXTRACTIONS = Number(
    process.env.MAX_PENDING_EXTRACTIONS || 8,
  );
  let pendingExtractions = 0;
  function requireExtractionCapacity() {
    if (pendingExtractions >= MAX_PENDING_EXTRACTIONS)
      throw fail(
        503,
        "Document processing is at capacity. Try again in a few minutes.",
      );
  }
  function scheduleExtraction(id, buffer, mime) {
    pendingExtractions += 1;
    void extract(id, buffer, mime)
      .catch((error) =>
        console.error("Document extraction failed:", error.message),
      )
      .finally(() => {
        pendingExtractions -= 1;
      });
  }
  async function extract(id, buffer, mime) {
    let text = "",
      status = "ready";
    try {
      if (mime === "text/plain") text = buffer.toString("utf8");
      else if (mime === "application/pdf") {
        const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
        const result = await pdf(buffer, { max: 100 });
        text = result.text;
        if (!text.trim()) status = "needs_ocr";
      } else {
        const previous = ocrTail;
        let release;
        ocrTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          const { createWorker } = await import("tesseract.js");
          const { default: language } = await import("@tesseract.js-data/eng");
          const worker = await createWorker("eng", 1, {
            langPath: language.langPath,
            cacheMethod: "none",
            logger: () => {},
          });
          try {
            const result = await worker.recognize(buffer);
            text = result.data.text;
          } finally {
            await worker.terminate();
          }
          if (!text.trim()) status = "needs_ocr";
        } finally {
          release();
        }
      }
    } catch {
      status = "failed";
    }
    await transaction(db, async () => {
      await db.prepare("UPDATE documents SET text=?,status=? WHERE id=?").run(
        text.slice(0, 250000),
        status,
        id,
      );
      const d = await db.prepare("SELECT mine_id FROM documents WHERE id=?").get(id);
      if (d)
        audit(
          db,
          { id: "system", name: "Document processor" },
          "extracted_text",
          `document:${id}`,
          d.mine_id,
          { status, characters: Math.min(text.length, 250000) },
        );
    });
    events.emit("change");
  }
  app.post(
    "/api/documents",
    uploadLimit,
    async (req, res, next) => {
      try {
        requireRole(req.user, ["admin", "officer"]);
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single("file"),
    async (req, res) => {
      const mineId = z.string().parse(req.body.mineId);
      await requireMine(req.user, mineId);
      if (!req.file) throw fail(400, "Choose a document to upload");
      const f = req.file,
        b = f.buffer;
      let mime = "";
      if (b.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
      else if (b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
        mime = "image/png";
      else if (b[0] === 255 && b[1] === 216 && b[2] === 255)
        mime = "image/jpeg";
      else if (f.originalname.toLowerCase().endsWith(".txt") && !b.includes(0))
        mime = "text/plain";
      if (!mime)
        throw fail(
          400,
          "Supported files: PDF, PNG, JPEG, and plain text (10 MB maximum)",
        );
      // Check capacity before storing anything, so a rejected upload leaves no
      // document stuck in "processing".
      requireExtractionCapacity();
      const id = uuid(),
        storageName = id + ".bin";
      const name = path.basename(f.originalname).slice(0, 200);
      fs.writeFileSync(path.join(uploadDir, storageName), b);
      try {
        await transaction(db, async () => {
          await db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)").run(
            id,
            mineId,
            name,
            mime,
            f.size,
            storageName,
            "",
            "processing",
            req.user.id,
            now(),
          );
          await audit(db, req.user, "uploaded", `document:${id}`, mineId, {
            name,
            size: f.size,
            sha256: createHash("sha256").update(b).digest("hex"),
          });
        });
      } catch (e) {
        fs.unlinkSync(path.join(uploadDir, storageName));
        throw e;
      }
      scheduleExtraction(id, b, mime);
      res
        .status(201)
        .json(
          publicDoc(await db.prepare("SELECT * FROM documents WHERE id=?").get(id)),
        );
    },
  );
  app.get("/api/documents/:id/download", async (req, res) => {
    const d = db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(req.params.id);
    if (!d) throw fail(404, "Document not found");
    await requireMine(req.user, d.mine_id);
    res.type(d.mime);
    res.download(path.join(uploadDir, d.storage_name), d.name);
  });
  app.post("/api/documents/:id/retry", uploadLimit, async (req, res) => {
    requireRole(req.user, ["admin", "officer"]);
    const d = db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(req.params.id);
    if (!d) throw fail(404, "Document not found");
    await requireMine(req.user, d.mine_id);
    if (d.status === "processing")
      throw fail(409, "Extraction is already running");
    requireExtractionCapacity();
    await db.prepare("UPDATE documents SET status='processing' WHERE id=?").run(d.id);
    scheduleExtraction(
      d.id,
      fs.readFileSync(path.join(uploadDir, d.storage_name)),
      d.mime,
    );
    await audit(db, req.user, "retried_extraction", `document:${d.id}`, d.mine_id);
    res.json({ ok: true });
  });
  const aiLimit = rateLimit({
    keyGenerator: (req) => req.user.id,
    windowMs: 60000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Please wait a minute before another AI request." },
  });
  const MAX_CONCURRENT_AI = Number(process.env.MAX_CONCURRENT_AI || 4);
  let inFlightAi = 0;
  function requireAiCapacity() {
    if (inFlightAi >= MAX_CONCURRENT_AI)
      throw fail(
        503,
        "The assistant is handling other requests. Please retry shortly.",
      );
  }
  app.post("/api/ai/chat", aiLimit, async (req, res) => {
    const { question, mineId } = z
      .object({
        question: z.string().trim().min(3).max(2000),
        mineId: z.string().optional(),
      })
      .parse(req.body);
    const rows = await scopedRecords(req.user, mineId, { limit: 500 }),
      mines = await scopedMines(req.user, mineId),
      ids = new Set(mines.map((m) => m.id));
    const docs = ids.size
      ? db
          .prepare(
            `SELECT * FROM documents WHERE status='ready' AND text<>'' AND mine_id IN (${placeholders(ids.size)}) ORDER BY created_at DESC LIMIT 200`,
          )
          .all(...ids)
      : [];
    requireAiCapacity();
    inFlightAi += 1;
    let response;
    try {
      response = await chat(
        db,
        question,
        rows,
        mines,
        docs,
        insights(rows, mines),
        aiPolicy(demo),
      );
    } catch (e) {
      console.error(
        "AI request failed; sensitive provider details suppressed.",
      );
      throw fail(
        502,
        "The AI provider is unavailable or returned an invalid response. Your records are unaffected.",
      );
    } finally {
      inFlightAi -= 1;
    }
    audit(
      db,
      req.user,
      "queried_assistant",
      "ai",
      mineId && mineId !== "all" ? mineId : null,
      { mode: response.mode, sourceIds: response.sources.map((s) => s.id) },
    );
    res.json(response);
  });
  app.post("/api/ai/analysis", aiLimit, async (req, res) => {
    const filter = z
      .object({ mineId: z.string().optional() })
      .parse(req.body).mineId;
    const signals = insights(
      await scopedRecords(req.user, filter),
      await scopedMines(req.user, filter),
    );
    requireAiCapacity();
    inFlightAi += 1;
    let response;
    try {
      response = await decision(signals, aiPolicy(demo));
    } catch (e) {
      console.error(
        "Decision provider request failed; sensitive details suppressed.",
      );
      throw fail(
        502,
        "The decision model is unavailable. Rule-based signals remain accessible.",
      );
    } finally {
      inFlightAi -= 1;
    }
    audit(
      db,
      req.user,
      "reviewed_risk",
      "ai",
      filter && filter !== "all" ? filter : null,
      { mode: response.mode },
    );
    res.json(response);
  });
  app.get("/api/reports/:format", async (req, res) => {
    if (!["csv", "pdf"].includes(req.params.format))
      throw fail(400, "Choose CSV or PDF");
    const kind = req.query.kind || "compliance";
    if (!statuses[kind]) throw fail(400, "Unknown report type");
    let rows = await scopedRecords(req.user, req.query.mine, {
      kind,
      limit: EXPORT_LIMIT_MAX + 1,
    });
    const from = req.query.from,
      to = req.query.to;
    for (const d of [from, to])
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(String(d)))
        throw fail(400, "Use YYYY-MM-DD report dates");
    if (from && to && from > to)
      throw fail(400, "Start date must precede end date");
    if (from)
      rows = rows.filter(
        (r) => (r.dueDate || r.createdAt.slice(0, 10)) >= from,
      );
    if (to)
      rows = rows.filter((r) => (r.dueDate || r.createdAt.slice(0, 10)) <= to);
    if (rows.length > EXPORT_LIMIT_MAX)
      throw fail(
        413,
        `Exports are limited to ${EXPORT_LIMIT_MAX} rows. Narrow the mine, date or type filters.`,
      );
    const mines = await scopedMines(req.user, req.query.mine);
    const mineName = (id) => mines.find((m) => m.id === id)?.name || id;
    audit(
      db,
      req.user,
      "exported",
      `report:${kind}`,
      req.query.mine && req.query.mine !== "all" ? req.query.mine : null,
      { format: req.params.format, rows: rows.length, from, to },
    );
    res.attachment(
      `coalguard-${kind}-${new Date().toISOString().slice(0, 10)}.${req.params.format}`,
    );
    if (req.params.format === "csv") {
      const cell = (v) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const data = [
        [
          "ID",
          "Mine",
          "Title",
          "Category",
          "Status",
          "Priority",
          "Date",
          "Owner",
          "Notes",
          "Details",
        ],
        ...rows.map((r) => [
          r.id,
          mineName(r.mineId),
          r.title,
          r.category,
          r.status,
          r.priority,
          r.dueDate,
          r.owner,
          r.notes,
          JSON.stringify(r.data),
        ]),
      ];
      res
        .type("text/csv")
        .send("\uFEFF" + data.map((r) => r.map(cell).join(",")).join("\r\n"));
    } else {
      res.type("application/pdf");
      const pdf = new PDFDocument({ margin: 48, size: "A4" });
      pdf.pipe(res);
      pdf.fontSize(25).fillColor("#183e33").text("CoalGuard");
      pdf.fontSize(16).text(`${String(kind).toUpperCase()} GOVERNANCE REPORT`);
      pdf
        .moveDown()
        .fontSize(9)
        .fillColor("#666666")
        .text(`Generated ${now()} | ${req.user.name} | ${rows.length} records`);
      pdf.text(
        demo
          ? "DEMONSTRATION DATA - not an official statutory filing."
          : "Internal governance report - authorized review required before statutory submission.",
      );
      pdf.moveDown();
      for (const r of rows) {
        if (pdf.y > 700) pdf.addPage();
        pdf.fontSize(12).fillColor("#183e33").text(r.title);
        pdf
          .fontSize(9)
          .fillColor("#444444")
          .text(
            `${mineName(r.mineId)} | ${r.status.replaceAll("_", " ")} | ${r.priority} priority`,
          );
        pdf.text(`Date: ${r.dueDate || "-"} | Owner: ${r.owner}`);
        if (r.notes) pdf.text(r.notes);
        pdf.moveDown();
      }
      pdf.end();
    }
  });
  app.use("/api", async (req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  if (fs.existsSync(path.resolve("dist/index.html"))) {
    app.use(express.static(path.resolve("dist")));
    app.get("/{*splat}", async (req, res) =>
      res.sendFile(path.resolve("dist/index.html")),
    );
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (err instanceof multer.MulterError)
      return res.status(400).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "File exceeds the 10 MB limit"
            : err.message,
      });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({
      error:
        "Unexpected server error. Please retry or contact your administrator.",
    });
  });
  return { app, db };
}
