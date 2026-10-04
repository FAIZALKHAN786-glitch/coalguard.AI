# Architecture and operating model

## Runtime

```text
Browser / installed PWA
  ├─ React + TypeScript, CSS glass surfaces, self-hosted fonts
  ├─ Recharts metrics, Leaflet GIS
  ├─ IndexedDB: per-user unsynced field reports
  ├─ Service worker: versioned application shell, never /api responses
  └─ Same-origin JSON/multipart requests + authenticated SSE
                  │
Express 5 API ─────┤
  ├─ Session authentication → role/mine authorization → Zod validation
  ├─ Transactions: record mutation + audit entry + idempotency receipt
  ├─ SQLite WAL: users, sessions, mines, records, documents, vectors, audit
  ├─ Private uploads: random filenames, signature-based type checks
  ├─ PDF extraction / serialized Tesseract English OCR
  ├─ Rule-based analytics / due-date notification evaluation
  ├─ PDF and formula-escaped CSV exports
  └─ HTTPS provider adapters: text / decision / embedding / reranking
```

SQLite is a deliberate pilot choice: no additional database installation, persistent transactional writes, and a small deployable footprint. The service boundary is explicit enough to replace storage/retrieval components when scaling. It is not yet a multi-tenant SaaS architecture.

## Core data and controls

- `users`: bcrypt password hash, role, assigned mine IDs. Admin access is portfolio-wide. Regulators can have portfolio or assigned-site visibility. Provisioned officers/field staff must have an assigned site.
- `sessions`: SHA-256 hashed random bearer token, user ID, 12-hour expiry. Normal deployments use an HttpOnly SameSite=Lax cookie. Explicit embedded demo mode uses a partitioned cookie and, only if cookies fail, may issue an opt-in one-hour bearer session stored only in tab memory. Production mode does not accept bearer fallback sessions.
- `records`: validated kind-specific payload, mine, status, priority, deadline/date, owner, notes, revision, timestamps. Updates must carry the current revision.
- `idempotency`: unique user/key receipt. Offline replays return the initial field record without a second insert or audit event.
- `documents`: private storage reference, verified media type, extracted text and processing status. Downloads repeat access checks.
- `audit`: actor, action, entity, mine, payload, UTC timestamp, previous hash, own hash. Mutations and their audit entries commit atomically. Hash verification uses stable key ordering.
- `read_notifications`: user-scoped acknowledgments. Notification identity includes record, date, and status so material workflow changes can create a new reminder.

Inputs and UI are not trusted authorization boundaries. The API checks both original and requested target mine on record changes. Evidence documents and corrective-action source records must belong to the same mine.

## Workflow semantics

Compliance: officers may create and progress obligations, then choose `under_review`. Only an administrator can set `compliant`; a review note/evidence reference is mandatory. This is a recorded workflow approval, **not a PKI signature**.

Inspections: scheduled → in progress → completed; cancellation is explicit. Findings are stored with the inspection. Corrective actions can reference source IDs; resolved actions require resolution evidence. Authorized users can revise statuses, with every change retained in audit history.

Field reporting: device UTC capture time and optional consented GPS/accuracy are separate from server receipt time. Offline queues retain the initial payload. Location-unavailable reports are permitted and explicitly labelled; absence of GPS is never disguised.

Notifications: obligations/actions/inspections/contracts due in seven days or less are evaluated from current records. Overdue items escalate after seven days. No cron or email delivery is implied. SSE refreshes connected clients on changes; a 30-second timer and reconnect refresh provide fallback. SSE contains invalidation messages only, never record payloads.

## API surface

All routes below except health/config/sign-in require a session. Response errors are JSON `{ "error": "…" }`.

| Method         | Path                                | Purpose                                                 |
| -------------- | ----------------------------------- | ------------------------------------------------------- |
| GET            | `/api/health`, `/api/config`        | Liveness and public demo flag                           |
| POST           | `/api/auth/login`, `/api/auth/demo` | Password / explicitly enabled demo access               |
| GET / POST     | `/api/auth/me`, `/api/auth/logout`  | Current identity / revoke session                       |
| GET            | `/api/events`                       | Session-authenticated SSE invalidation stream           |
| GET / POST     | `/api/mines`                        | Scoped portfolio / administrator provisioning           |
| GET            | `/api/dashboard?mine=all`           | Derived metrics, site scores, trends, risk evidence     |
| GET / POST     | `/api/records/:kind`                | List/search/filter or create validated records          |
| PATCH / DELETE | `/api/records/:kind/:id`            | Version-checked update / administrator deletion         |
| GET            | `/api/notifications?mine=all`       | Evaluated reminders and escalation flags                |
| POST           | `/api/notifications/read`           | Acknowledge visible notification IDs                    |
| GET            | `/api/documents?mine=all`           | Mine-scoped metadata and extracted text                 |
| POST           | `/api/documents`                    | Multipart `file` + `mineId`                             |
| GET            | `/api/documents/:id/download`       | Authorized attachment download                          |
| POST           | `/api/documents/:id/retry`          | Retry extraction; officer/admin only                    |
| GET            | `/api/integrations`                 | Configuration flags, not secrets or health guarantees   |
| POST           | `/api/ai/chat`                      | `{question, mineId}`; scoped evidence-grounded response |
| POST           | `/api/ai/analysis`                  | `{mineId}`; advisory review of screening signals        |
| GET            | `/api/reports/:format`              | `csv` / `pdf`; `kind`, `mine`, `from`, `to` filters     |
| GET            | `/api/audit?mine=all`               | Latest 500 visible audit entries                        |
| GET            | `/api/audit/verify`                 | Administrator/regulator hash-chain verification         |
| GET / POST     | `/api/users`                        | Administrator team list / account provisioning          |

Kinds: `compliance`, `inspection`, `action`, `contractor`, `operation`, `environment`, `attendance`, `grievance`, `field`.

Write payload common fields: `mineId`, `title`, `category`, `status`, `priority`, `dueDate`, `owner`, `notes`, `data`; updates additionally require `version`. The authoritative per-kind schemas are in `server/schemas.js`.

## AI and privacy

Only authorized records/documents enter context. Retrieval uses keyword scoring by default; optional cosine-similarity embeddings and reranking refine document selection. Retrieved content is explicitly treated as untrusted data in the system instruction. Models have no tool-execution or approval capability. This reduces action risk but does not eliminate prompt injection or hallucinations; review all output against source evidence.

The provider receives scoped context and its own authorization credential, not user session credentials. Provider keys are read from private runtime environment settings or mounted secret files; they are not sent to the browser. External providers are disabled in demo mode and require AI_ENABLED=true in a non-demo deployment. The audit stores query mode/source IDs, not the full user question. Avoid sending unnecessary worker PII; apply organizational data-retention and external-processor policies before connecting models.

## Deployment hardening checklist

1. Fresh non-demo database, secure secrets, HTTPS, secure cookies, and trusted reverse proxy configuration. `trust proxy=1` assumes exactly one trusted ingress.
2. Restrict embedding origins in Helmet/reverse-proxy CSP to your actual host; Arena preview origins are currently allowed for evaluation.
3. Controlled onboarding and account recovery, MFA/SSO, password rotation and account disable flows, periodic access review.
4. Encryption at rest, encrypted backups, malware scanning/quarantine, quotas, upload retention and safe purge policies.
5. Independently assess document-parser/OCR resource limits. Isolate background workers for untrusted bulk uploads; do not run unbounded jobs in the web process.
6. Add observability, durable job scheduling, outbound reminder delivery, shared rate limits, external audit anchoring, and recovery exercises.
7. Validate legal controls and model performance with authorized mining, safety, labour, and environmental specialists.
8. For multi-instance scale: PostgreSQL, private object storage, durable queue, vector indexing, shared sessions/rate limits, and cross-instance invalidation/event delivery.

## Provider credential boundary

See [SECRETS.md](SECRETS.md) for the precise limits of runtime secret protection. The app now enforces a provider-host allowlist, blocks HTTP redirects, suppresses raw provider exceptions, and gates all external text/decision/embedding/reranking requests behind server-owned activation policy. Request bodies cannot enable provider access. Hosting IAM, secret encryption at rest, provider credit limits, and production operator controls are not provisioned by this repository.
