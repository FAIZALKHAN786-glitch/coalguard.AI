# CoalGuard.ai

A working full-stack governance workspace for the Indian coal-mining ecosystem. React + TypeScript, an Express API, persistent SQLite records, a responsive glass-and-sage interface, and an installable field-reporting PWA.

**This is a deployable pilot, not certified mining-safety software or a regulator-approved filing system.** Seeded operational records are fictional; mine names and approximate locations are provided for demonstration, without affiliation or endorsement.

## Run locally

Requires **Node.js 22.13+** (uses `node:sqlite`) and npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite binds to `0.0.0.0` and proxies `/api` to port 3001. Browser requests use same-origin URLs, including in Arena previews. Development defaults to demo mode; the demonstration workspace opens automatically unless you explicitly sign out. For an HTTPS Arena preview embedded in the workspace, use `npm run dev:preview` instead; it enables the demo-only partitioned-session and cookie-free fallback needed when embedded browsers block cookies.

### Demo accounts

All demo accounts use password **`CoalGuard@2026`**. These accounts exist only in a newly initialized demo database.

| Email                      | Role          | Access                                                 |
| -------------------------- | ------------- | ------------------------------------------------------ |
| `admin@coalguard.demo`     | Administrator | All sites; compliance approval; users and mines        |
| `officer@coalguard.demo`   | Mine officer  | Gevra and Dipka; operational workflows; submit reviews |
| `field@coalguard.demo`     | Field staff   | Gevra; field reports, attendance, grievances           |
| `regulator@coalguard.demo` | Regulator     | Portfolio read access; export and audit verification   |

Sign out, then sign in with another account to evaluate permissions. Permissions and mine scope are enforced by the API, not just hidden in the interface.

### Sign-in in an embedded preview

If a session expires, CoalGuard now opens the sign-in screen instead of leaving a protected dashboard showing a 401 error. Sign-in also checks that the browser accepted the session before entering the workspace.

For the development server in an HTTPS Arena preview, run `npm run dev:preview`; it turns on the embedded-preview mode needed for the browser's partitioned-cookie policy. For a built **demonstration** embedded in Arena, set `DEMO_MODE=true EMBEDDED_PREVIEW=true COOKIE_SECURE=true`. This uses a separate `__Host-` session cookie with `Secure`, `HttpOnly`, `SameSite=None`, and `Partitioned` attributes so the cookie is scoped to the embedding site's partition. The same-origin write checks remain enforced. Non-demo deployments refuse this option and retain normal SameSite=Lax cookies.

If the browser or preview proxy drops cookies, embedded **demo mode only** can issue a short-lived (one-hour), server-validated session carried in an application-specific `X-CoalGuard-Session` header (so a preview gateway can reserve `Authorization`). The client keeps this session credential in the current tab's JavaScript memory—never in localStorage, sessionStorage, URLs, or service-worker caches. This is not an AI provider key. Reloading loses this fallback session. Role/mine checks, expiry, revocation, and same-origin write protection still apply. Ordinary production mode neither issues nor accepts this fallback. Because JavaScript can access a memory credential, use it only for demonstration data; do not attach production AI keys to a public demo.

Memory-session previews use authenticated 30-second polling instead of native EventSource. Exports and document downloads use authenticated fetches. Blocked browser storage no longer prevents online sign-in (offline persistence still requires working browser storage). Sign-in failures and non-JSON proxy responses are shown explicitly.

For a proxy that rewrites the Host header, set `APP_ORIGIN` to the exact trusted public origin. Untrusted forwarded-host values are not used to authorize requests. Demo access is available through **Enter demo workspace**, or `admin@coalguard.demo` / `CoalGuard@2026`. Arena URLs can require opening the preview inside the Arena chat; a new tab is not guaranteed to bypass that platform restriction.

## What works

- **Portfolio dashboard:** database-derived compliance coverage, production trends/targets, inspection counts, outstanding actions, upcoming inspections, and site-level risk screening.
- **Mine network:** GIS map, actual coordinates, risk markers, mine/subsidiary records, and site scoping. OpenStreetMap basemap tiles require connectivity.
- **Compliance:** safety/environment/labour/production controls; responsible person, deadlines, evidence references, status, priority, officer review submissions, and administrator-only approval with review notes.
- **Inspections and corrective actions:** findings, scheduling, source-record links, ownership, deadlines, and resolution evidence required for closure.
- **Contractors:** deployed workforce, contact details, labour-licence references, contract expiry, and operating status.
- **Operations, environment, attendance, and grievances:** create/read/update/delete workflows, validated measurements and dates, search, filters, pagination, and exports.
- **Field PWA:** mobile layout, consent-based device geolocation and accuracy, original capture timestamp, IndexedDB offline queue, explicit sync, and server-side idempotency. Reports are never assigned fabricated GPS coordinates.
- **Live updates:** authenticated Server-Sent Events invalidate client data after writes; 30-second refresh is a fallback. Notifications derive from the current record state, with due-soon reminders, overdue flags, and escalation after seven days overdue.
- **Documents:** private PDF/TXT/PNG/JPEG storage, PDF text extraction, bundled English image OCR, retryable extraction states, evidence IDs, authenticated download, and searchable extracted text. Upload limit: 10 MB.
- **Intelligence:** deterministic, evidence-linked risk signals; optional decision/text/embedding/reranking adapters. Missing keys result in honestly labelled rule-based output, not simulated AI.
- **Reports:** actual CSV/PDF downloads, mine and date filters, export auditing, spreadsheet-formula escaping. Reports are internal governance documents, not statutory submission formats.
- **Audit:** transactional record-change logging and SHA-256 linked entries, with verification. Deleting a record does not delete its audit history.
- **Access:** bcrypt password hashes, hashed expiring session tokens, HttpOnly cookies, same-origin write protection, role/mine restrictions, input validation, optimistic revision checks, and rate limits.

## Connect your AI providers

**External AI now requires a private, non-demo deployment and explicit activation.** Demo mode blocks all provider requests even if credentials are present. Read [Protecting your API key](docs/SECRETS.md) before adding real credentials. This coding workspace is not a secret manager.

```dotenv
DEMO_MODE=false
AI_ENABLED=true
AI_ALLOWED_HOSTS=openrouter.ai
```

Use a fresh non-demo database; do not simply change the demo flag against the seeded database. Add other provider hostnames to the exact allowlist only after verifying them. Use a host-managed `AI_TEXT_API_KEY` secret or a read-only `AI_TEXT_API_KEY_FILE` mount outside the repository—not both.

Copy `.env.example` and set the provider values **on the server**. Never put secrets in `VITE_*` variables, browser code, commits, or chat. Restart the API after configuration changes. Settings shows configuration and deployment-policy state, never credentials; “Configured” is not an independent connectivity check.

```dotenv
AI_TEXT_BASE_URL=https://your-provider.example/v1
AI_TEXT_API_KEY=set-through-private-host-secrets
AI_TEXT_MODEL=your-text-model-id

AI_DECISION_BASE_URL=https://your-provider.example/v1
AI_DECISION_API_KEY=set-through-private-host-secrets
AI_DECISION_MODEL=your-decision-model-id

AI_EMBEDDING_BASE_URL=https://your-provider.example/v1
AI_EMBEDDING_API_KEY=set-through-private-host-secrets
AI_EMBEDDING_MODEL=your-embedding-model-id

AI_RERANK_BASE_URL=https://your-provider.example/v2
AI_RERANK_API_KEY=set-through-private-host-secrets
AI_RERANK_MODEL=your-reranker-model-id
```

- Text and decision providers must accept OpenAI-compatible `POST /chat/completions`. Decision output uses `response_format: { type: "json_object" }` and is validated against a JSON schema.
- Embeddings use OpenAI-compatible `POST /embeddings`; vectors are cached by document and provider/model.
- Reranking uses a Cohere-compatible `POST /rerank` accepting `query`, `documents`, and `top_n`, returning `results: [{index, relevance_score}]`.
- Supply the **base URL**, not the endpoint suffix. HTTPS and an approved `AI_ALLOWED_HOSTS` hostname are required. Adapters do not assume that every proprietary API is OpenAI-compatible.
- Each provider call times out after 45 seconds. Text/decision failures surface an error; retrieval failures retain keyword ordering and report the fallback.
- Relevant mine records and extracted document content are sent to the configured providers. Obtain authorization and assess data residency, confidentiality, retention, and PII requirements before enabling them.
- All recommendations require human review. The assistant cannot approve records, execute operations, or submit filings.

## Production / pilot deployment

Use a **fresh database**, turn off demo mode, and set a strong initial administrator password. The server refuses to run in non-demo mode with a known demo database.

```dotenv
DEMO_MODE=false
DATABASE_PATH=./data/production.sqlite
ADMIN_EMAIL=admin@your-organization.in
ADMIN_PASSWORD=use-a-long-unique-secret-from-your-secret-manager
COOKIE_SECURE=true
PORT=3001
```

```bash
npm ci
npm run build
npm start
```

The production server serves both the frontend and `/api` on port 3001. Place it behind an HTTPS reverse proxy; preserve `Host`, forward the scheme, and disable buffering for `/api/events`. Secure cookies require HTTPS. The initial administrator is created only when the database has no users; changing `ADMIN_PASSWORD` later does **not** rotate an existing user's password.

```bash
docker build -t coalguard .
docker run --name coalguard --env-file .env.production \
  -p 3001:3001 -v coalguard-data:/app/data coalguard
```

`data/` and `.env*` are ignored by Git. Back up the **SQLite database and private uploads together**. Use the SQLite backup API or stop the server before copying the database; copying a live WAL database alone can omit recent transactions. Encrypt backups and test restoration.

### Offline field use

The service worker is enabled in **production builds**, not the Vite development server. Open the built app online once; its shell and self-hosted fonts are cached. Navigate to Field workspace, disconnect, create reports, reconnect, and use **Sync reports**. The capture time is retained; replays do not duplicate records.

Only unsynced field reports plus the minimal user/site bootstrap are stored locally. Protected API responses and uploaded documents are not service-worker cached. Queues are partitioned by user ID; server authorization is checked again during sync. Browser storage is not encrypted application storage: use trusted devices, and do not clear browser storage until reports have synced. Native background sync and a native iOS/Android binary are not included.

## Verification

```bash
npm run check          # TypeScript
npm test               # API security, workflow, and AI adapter tests
npm run test:browser   # Builds the app; full browser workflow tests
npm run test:auth-browser # HTTPS iframe cookies, expiry recovery, blocked-cookie guidance
npm audit --omit=dev
```

Browser tests use a disposable SQLite database and bundled headless Chromium. They cover desktop/mobile rendering, inspection CRUD, filters/search, AI fallback, document upload, actual image OCR, a full offline reload/queue/sync cycle, all navigation destinations, and audit verification. Screenshots are written to ignored `test-results/`. The bundled browser harness targets Linux x64; use an appropriate Playwright browser for other platforms.

## Important deployment boundaries

- This implementation is **single-organization, multi-mine**, with SQLite WAL and local file storage. It is appropriate for a pilot on a single persistent server, not a claim of proven nationwide high availability. Move to PostgreSQL, object storage, shared event delivery, and durable background workers before horizontal scaling.
- Statutory references and deadlines are illustrative, **not a maintained legal rules library**. Validate controls against current law, licences, site consents, and regulatory directions.
- Screening thresholds (PM₁₀ >100 µg/m³, noise >75 dB, pH outside 6.5–8.5, output below 80% of target) are illustrative. Sampling method, averaging periods, and site limits must govern legal interpretation. Risk screening is not a trained predictive model.
- Notifications are **in-app**. Email/SMS/WhatsApp/push providers, regulatory portal submissions, ERP/HRIS connectors, SSO/MFA, and native device attestation are not wired up.
- Image OCR supports English. Scanned PDFs without a text layer are clearly marked; upload page images for OCR. Text PDF extraction is limited to 100 pages and stored extraction to 250,000 characters. OCR is serialized within the process; interrupted work is marked failed and can be retried.
- Retrieval embeds at most 30 authorized documents per request, using the first 12,000 characters of each. It is not a full vector-database/chunking pipeline. The text assistant sees a bounded workspace snapshot and up to four retrieved documents.
- Audit chaining is **tamper-evident, not immutable**: a privileged database operator could rewrite the entire chain. For stronger assurance, externally anchor signed hashes and use write-once retention.
- User provisioning is available. Enterprise account lifecycle, self-service recovery, password rotation, malware scanning, independently reviewed accessibility/security, disaster recovery, and operational SLAs must be addressed before a sensitive live deployment.

See [architecture and API notes](docs/ARCHITECTURE.md).
