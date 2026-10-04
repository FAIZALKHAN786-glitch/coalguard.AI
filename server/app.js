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
  uuid,
  now,
  audit,
  verifyAudit,
  record,
  transaction,
} from "./db.js";
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
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  mines: JSON.parse(u.mines),
});
export function createApp({
  database = process.env.DATABASE_PATH || "./data/coalguard.sqlite",
  demo = process.env.DEMO_MODE === "true" ||
    (process.env.DEMO_MODE === undefined &&
      process.env.NODE_ENV !== "production"),
  uploads,
  embeddedPreview = process.env.EMBEDDED_PREVIEW === "true",
  publicOrigin = process.env.APP_ORIGIN,
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
  const db = openDatabase(database);
  if (!demo && db.prepare("SELECT id FROM users WHERE id='u-admin'").get()) {
    db.close();
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
  db.prepare(
    "UPDATE documents SET status='failed' WHERE status='processing'",
  ).run();
  const app = express();
  const events = new EventEmitter();
  events.setMaxListeners(0);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
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
            "https://*.tile.openstreetmap.org",
          ],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          frameAncestors: [
            "'self'",
            "https://*.arena.ai",
            "https://arena.ai",
            "https://*.e2b.app",
            ...(embeddedPreview ? ["https://*.arena.site"] : []),
          ],
        },
      },
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );
  // Arena preview embeds the application; production deployments may set stricter frame-ancestors at their reverse proxy.
  app.use((req, res, next) => {
    res.removeHeader("X-Frame-Options");
    if (process.env.NODE_ENV !== "production")
      res.removeHeader("Content-Security-Policy");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
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
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/config", (req, res) =>
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
  function session(res, u, memory = false) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
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
    const accessToken = session(res, u, memory);
    audit(db, u, "signed_in", "session", null);
    res.json({
      user: safeUser(u),
      ...(memory ? { accessToken, transport: "memory" } : {}),
    });
  });
  app.post("/api/auth/demo", authLimit, (req, res) => {
    if (!demo) throw fail(404, "Demo access is disabled");
    const u = db.prepare("SELECT * FROM users WHERE id='u-admin'").get();
    if (!u) throw fail(404, "Demo workspace is unavailable");
    const memory = memoryRequested(req);
    const accessToken = session(res, u, memory);
    res.json({
      user: safeUser(u),
      ...(memory ? { accessToken, transport: "memory" } : {}),
    });
  });
  app.use("/api", (req, res, next) => {
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
    const u =
      token &&
      db
        .prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        )
        .get(sessionKey(token), Date.now());
    if (!u)
      return res.status(401).json({ error: "Please sign in to continue" });
    req.user = safeUser(u);
    req.sessionTokenHash = sessionKey(token);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      res.once("finish", () => {
        if (res.statusCode < 300) events.emit("change");
      });
    next();
  });
  const mineAccess = (u, id) =>
    u.role === "admin" || u.mines.length === 0 || u.mines.includes(id);
  function requireMine(u, id) {
    if (!db.prepare("SELECT id FROM mines WHERE id=?").get(id))
      throw fail(404, "Mine not found");
    if (!mineAccess(u, id))
      throw fail(403, "This mine is outside your assigned access");
  }
  function requireRole(u, roles) {
    if (!roles.includes(u.role))
      throw fail(403, "Your role does not permit this action");
  }
  function scopedMines(u, filter) {
    if (filter && filter !== "all") requireMine(u, filter);
    return db
      .prepare("SELECT * FROM mines ORDER BY name")
      .all()
      .filter(
        (m) =>
          mineAccess(u, m.id) &&
          (!filter || filter === "all" || filter === m.id),
      );
  }
  function scopedRecords(u, filter) {
    const ids = new Set(scopedMines(u, filter).map((m) => m.id));
    return db
      .prepare("SELECT * FROM records ORDER BY created_at DESC,rowid DESC")
      .all()
      .filter((r) => ids.has(r.mine_id))
      .map(record);
  }
  function canWrite(u, kind) {
    requireRole(u, [
      "admin",
      "officer",
      ...(["field", "attendance", "grievance"].includes(kind) ? ["field"] : []),
    ]);
  }
  app.get("/api/events", (req, res) => {
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
    const heartbeat = setInterval(() => {
      const valid = db
        .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
        .get(req.sessionTokenHash, Date.now());
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
  app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionTokenHash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    for (const key of ["mine", "q", "status", "kind", "from", "to"])
      if (
        req.query[key] !== undefined &&
        (typeof req.query[key] !== "string" || req.query[key].length > 500)
      )
        return res.status(400).json({ error: "Invalid query parameter" });
    next();
  });
  app.get("/api/mines", (req, res) => res.json(scopedMines(req.user)));
  app.post("/api/mines", (req, res) => {
    requireRole(req.user, ["admin"]);
    const m = mineSchema.parse(req.body);
    const id = uuid();
    transaction(db, () => {
      db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run(
        id,
        m.name,
        m.subsidiary,
        m.region,
        m.latitude,
        m.longitude,
        m.capacity,
      );
      audit(db, req.user, "created", "mine", id, m);
    });
    res.status(201).json({ id, ...m });
  });
  app.get("/api/dashboard", (req, res) => {
    const mines = scopedMines(req.user, req.query.mine);
    res.json({
      ...dashboard(scopedRecords(req.user, req.query.mine), mines),
      updatedAt: now(),
    });
  });
  app.get("/api/records/:kind", (req, res) => {
    if (!statuses[req.params.kind]) throw fail(404, "Unknown record type");
    let rows = scopedRecords(req.user, req.query.mine).filter(
      (r) => r.kind === req.params.kind,
    );
    if (req.query.status)
      rows = rows.filter((r) => r.status === req.query.status);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      rows = rows.filter((r) =>
        (r.title + " " + r.owner + " " + r.category + " " + r.notes)
          .toLowerCase()
          .includes(q),
      );
    }
    res.json(rows);
  });
  app.post("/api/records/:kind", (req, res) => {
    const { kind } = req.params;
    if (!statuses[kind]) throw fail(404, "Unknown record type");
    canWrite(req.user, kind);
    const r = recordSchema(kind).parse(req.body);
    requireMine(req.user, r.mineId);
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
    if (key) {
      const old = db
        .prepare("SELECT record_id FROM idempotency WHERE user_id=? AND key=?")
        .get(req.user.id, key);
      if (old) {
        const existing = record(
          db.prepare("SELECT * FROM records WHERE id=?").get(old.record_id),
        );
        if (!existing)
          throw fail(409, "Previously submitted record was removed");
        return res.json(existing);
      }
    }
    const id = uuid(),
      time = now();
    transaction(db, () => {
      db.prepare(
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
      audit(db, req.user, "created", `${kind}:${id}`, r.mineId, r);
      if (key)
        db.prepare("INSERT INTO idempotency VALUES(?,?,?)").run(
          req.user.id,
          key,
          id,
        );
    });
    res
      .status(201)
      .json(record(db.prepare("SELECT * FROM records WHERE id=?").get(id)));
  });
  app.patch("/api/records/:kind/:id", (req, res) => {
    const { kind, id } = req.params;
    if (!statuses[kind]) throw fail(404, "Unknown record type");
    canWrite(req.user, kind);
    const before = record(
      db.prepare("SELECT * FROM records WHERE id=? AND kind=?").get(id, kind),
    );
    if (!before) throw fail(404, "Record not found");
    requireMine(req.user, before.mineId);
    const r = recordSchema(kind).parse(req.body);
    requireMine(req.user, r.mineId);
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
    transaction(db, () => {
      db.prepare(
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
    res.json(record(db.prepare("SELECT * FROM records WHERE id=?").get(id)));
  });
  app.delete("/api/records/:kind/:id", (req, res) => {
    requireRole(req.user, ["admin"]);
    const row = record(
      db
        .prepare("SELECT * FROM records WHERE id=? AND kind=?")
        .get(req.params.id, req.params.kind),
    );
    if (!row) throw fail(404, "Record not found");
    requireMine(req.user, row.mineId);
    transaction(db, () => {
      db.prepare("DELETE FROM records WHERE id=?").run(row.id);
      audit(db, req.user, "deleted", `${row.kind}:${row.id}`, row.mineId, row);
    });
    res.json({ ok: true });
  });
  app.get("/api/notifications", (req, res) => {
    const read = new Set(
      db
        .prepare(
          "SELECT notification_id FROM read_notifications WHERE user_id=?",
        )
        .all(req.user.id)
        .map((r) => r.notification_id),
    );
    res.json(
      notifications(scopedRecords(req.user, req.query.mine)).map((n) => ({
        ...n,
        read: read.has(n.id),
      })),
    );
  });
  app.post("/api/notifications/read", (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.string().max(200)).max(2000) })
      .parse(req.body);
    const allowed = new Set(
      notifications(scopedRecords(req.user)).map((n) => n.id),
    );
    transaction(db, () => {
      for (const id of ids)
        if (allowed.has(id))
          db.prepare(
            "INSERT OR IGNORE INTO read_notifications VALUES(?,?)",
          ).run(req.user.id, id);
    });
    res.json({ ok: true });
  });
  app.get("/api/audit", (req, res) => {
    const allowed = new Set(
      scopedMines(req.user, req.query.mine).map((m) => m.id),
    );
    res.json(
      db
        .prepare("SELECT * FROM audit ORDER BY id DESC")
        .all()
        .filter((r) =>
          r.mine_id ? allowed.has(r.mine_id) : req.user.role === "admin",
        )
        .slice(0, 500),
    );
  });
  app.get("/api/audit/verify", (req, res) => {
    requireRole(req.user, ["admin", "regulator"]);
    res.json(verifyAudit(db));
  });
  app.get("/api/users", (req, res) => {
    requireRole(req.user, ["admin"]);
    res.json(
      db.prepare("SELECT * FROM users ORDER BY name").all().map(safeUser),
    );
  });
  app.post("/api/users", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const u = userSchema.parse(req.body);
    for (const id of u.mines) requireMine(req.user, id);
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
    transaction(db, () => {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
        id,
        u.name,
        u.email.toLowerCase(),
        password,
        u.role,
        JSON.stringify(u.mines),
      );
      audit(db, req.user, "created", "user", null, {
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
  app.get("/api/integrations", (req, res) => {
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
  app.get("/api/documents", (req, res) => {
    const ids = new Set(scopedMines(req.user, req.query.mine).map((m) => m.id));
    res.json(
      db
        .prepare("SELECT * FROM documents ORDER BY created_at DESC")
        .all()
        .filter((d) => ids.has(d.mine_id))
        .map(publicDoc),
    );
  });
  let ocrTail = Promise.resolve();
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
    transaction(db, () => {
      db.prepare("UPDATE documents SET text=?,status=? WHERE id=?").run(
        text.slice(0, 250000),
        status,
        id,
      );
      const d = db.prepare("SELECT mine_id FROM documents WHERE id=?").get(id);
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
    (req, res, next) => {
      try {
        requireRole(req.user, ["admin", "officer"]);
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single("file"),
    (req, res) => {
      const mineId = z.string().parse(req.body.mineId);
      requireMine(req.user, mineId);
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
      const id = uuid(),
        storageName = id + ".bin";
      const name = path.basename(f.originalname).slice(0, 200);
      fs.writeFileSync(path.join(uploadDir, storageName), b);
      try {
        transaction(db, () => {
          db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)").run(
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
          audit(db, req.user, "uploaded", `document:${id}`, mineId, {
            name,
            size: f.size,
            sha256: createHash("sha256").update(b).digest("hex"),
          });
        });
      } catch (e) {
        fs.unlinkSync(path.join(uploadDir, storageName));
        throw e;
      }
      void extract(id, b, mime).catch((e) =>
        console.error("Document extraction failed:", e.message),
      );
      res
        .status(201)
        .json(
          publicDoc(db.prepare("SELECT * FROM documents WHERE id=?").get(id)),
        );
    },
  );
  app.get("/api/documents/:id/download", (req, res) => {
    const d = db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(req.params.id);
    if (!d) throw fail(404, "Document not found");
    requireMine(req.user, d.mine_id);
    res.type(d.mime);
    res.download(path.join(uploadDir, d.storage_name), d.name);
  });
  app.post("/api/documents/:id/retry", uploadLimit, (req, res) => {
    requireRole(req.user, ["admin", "officer"]);
    const d = db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(req.params.id);
    if (!d) throw fail(404, "Document not found");
    requireMine(req.user, d.mine_id);
    if (d.status === "processing")
      throw fail(409, "Extraction is already running");
    db.prepare("UPDATE documents SET status='processing' WHERE id=?").run(d.id);
    void extract(
      d.id,
      fs.readFileSync(path.join(uploadDir, d.storage_name)),
      d.mime,
    ).catch((e) => console.error(e.message));
    audit(db, req.user, "retried_extraction", `document:${d.id}`, d.mine_id);
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
  app.post("/api/ai/chat", aiLimit, async (req, res) => {
    const { question, mineId } = z
      .object({
        question: z.string().trim().min(3).max(2000),
        mineId: z.string().optional(),
      })
      .parse(req.body);
    const rows = scopedRecords(req.user, mineId),
      mines = scopedMines(req.user, mineId),
      ids = new Set(mines.map((m) => m.id));
    const docs = db
      .prepare("SELECT * FROM documents WHERE status='ready' AND text<>''")
      .all()
      .filter((d) => ids.has(d.mine_id));
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
      scopedRecords(req.user, filter),
      scopedMines(req.user, filter),
    );
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
  app.get("/api/reports/:format", (req, res) => {
    if (!["csv", "pdf"].includes(req.params.format))
      throw fail(400, "Choose CSV or PDF");
    const kind = req.query.kind || "compliance";
    if (!statuses[kind]) throw fail(400, "Unknown report type");
    let rows = scopedRecords(req.user, req.query.mine).filter(
      (r) => r.kind === kind,
    );
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
    const mines = scopedMines(req.user, req.query.mine);
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
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  if (fs.existsSync(path.resolve("dist/index.html"))) {
    app.use(express.static(path.resolve("dist")));
    app.get("/{*splat}", (req, res) =>
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
