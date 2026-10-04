# Protecting a long-lived OpenRouter key

A key does not need an automatic expiry to be stored safely. It does need controlled access, a bounded financial impact, monitoring, and a revocation/rotation plan. Expiry is an additional control, not encryption or access control.

## What CoalGuard now enforces

- **No external AI calls in demo mode**, including text, decision, embedding, and reranking calls. Adding a key to a public demo cannot activate provider requests.
- **Explicit activation:** private deployments must set both `DEMO_MODE=false` and `AI_ENABLED=true`. External calls are disabled by default; deterministic screening remains available.
- **Exact provider-host allowlist:** `AI_ALLOWED_HOSTS` restricts destinations. HTTPS is required. Redirects, URL credentials, query parameters, fragments, and nonstandard ports are rejected.
- **Two credential options:** hosting-provided environment secrets, or a mounted secret file via `AI_<TYPE>_API_KEY_FILE`. Exactly one source per model role is allowed.
- **No credential values or file contents in configuration responses.** Settings distinguishes configured models from models disabled by policy; configuration is not a health check.
- **Provider errors are not logged verbatim** by the API routes. Do not add request/header/body logging around provider calls.
- **Authenticated, mine-scoped API routes** and a 10-requests-per-minute limit per signed-in user for the AI routes. This request limit is not a spending cap: retrieval can make multiple provider requests.
- `.env`, secret directories, `.key` and `.pem` files are excluded from Git and container build context by default. Git ignore rules do not remove anything previously committed or exposed.

## Recommended option: private hosting secrets

Do this in the **production/staging host's private configuration**, not in a shared coding workspace. Enable MFA, limit operator access, and require code review for deployments.

Non-secret configuration:

```dotenv
DEMO_MODE=false
EMBEDDED_PREVIEW=false
AI_ENABLED=true
AI_ALLOWED_HOSTS=openrouter.ai
AI_TEXT_BASE_URL=https://openrouter.ai/api/v1
AI_TEXT_MODEL=liquid/lfm-2.5-2.6b:free
```

Set `AI_TEXT_API_KEY` separately through the host's secrets interface. Leave `AI_TEXT_API_KEY_FILE` unset. Do not put the real key in this document, `.env.example`, Git, build arguments, chat, or browser variables.

Use a fresh non-demo database and a private administrator account. Configure HTTPS, secure cookies, backups, and access restrictions before activation. The model above is an example for **fictional data**; its advertised retention/training policy is not appropriate for confidential records without organizational approval.

## Alternative: mount a secret file at runtime

If the deployment platform already supports secret-file mounts, mount the OpenRouter key read-only at an absolute path outside the application repository, for example `/run/secrets/openrouter_key`.

```dotenv
AI_TEXT_API_KEY=
AI_TEXT_API_KEY_FILE=/run/secrets/openrouter_key
```

Keep the activation and URL/model settings from the preceding example. The backend reads the file only when calling the provider. It accepts one key, optionally followed by a newline, with a maximum file size of 8 KiB. Empty, unreadable, oversized, relative-path, and conflicting credential configurations fail closed. File-path values can be documented; file **contents** must remain in the deployment secret system.

The file must be readable by the runtime service account (the Docker image runs as `node`) and not by unrelated accounts. Do not copy the file into the Docker image. A read-only mount prevents the application from changing the file; it does **not** stop the application from reading it.

**This application does not provision a cloud vault, encrypt secret mounts, manage cloud IAM, or prevent a production administrator from reading a runtime key.** Those controls belong to your hosting/secret-management system. A process that can call the AI provider necessarily has access to a usable credential. Code changes by someone with deployment access can also misuse it, which is why trusted deployments and operator restrictions matter.

## OpenRouter account controls

1. Use a dedicated key for CoalGuard rather than sharing a key across unrelated projects.
2. Set a small per-key credit limit in OpenRouter and review usage. Application request limits are not a substitute for a provider-side cap.
3. Keep development and production credentials separate when possible.
4. Rotate/revoke the key when a collaborator leaves, after suspected exposure, and according to your organization's rotation policy. A key with no expiry can still be revoked.
5. Do not send confidential mine or worker data to a provider until its retention, training, residency, and contractual terms are approved.

## If the key was already entered here

An ignored `.env` is plain text and readable by the workspace owner and coding agents. File permissions such as `0600` restrict other operating-system users, not agents running as the same user. Encryption with a decryption key kept in the same workspace does not solve that trust boundary.

If the key was committed, pasted into chat, or exposed to someone who should not have it, revoke it in OpenRouter and create a replacement. Deleting the text does not revoke an already exposed credential. For an unshared local `.env`, assess who could access that machine/workspace; the existence of a local file alone is not evidence of a leak.

## Verification

`npm test` includes checks that configured demo workspaces make **zero provider requests**, only authenticated private calls can activate models, disabled deployments retain rules, secret-file configuration is validated, and unapproved provider destinations and redirects are blocked. Tests use fabricated credentials and mocked provider responses. They do not test or alter your actual OpenRouter key, credit limits, or hosting account.
