# Runbook

## Local development

1. Install Node 22.11+ and Python 3.11+. WorkOS AuthKit's current Next.js SDK requires Node 22.11 or newer.
2. Copy `.env.example` to the relevant app/service environment file. Run `npx convex dev --once` to bind the local project, generate `convex/_generated`, and deploy the schema to the configured development deployment.
3. Run `npm install`, then `npm run dev` for the web app.
4. In `services/watermark-worker`, create a virtual environment and run `pip install -e '.[dev]'`. Use `traceanytong-worker run` for the continuous lease-safe worker, or `uvicorn app.main:app --reload` when developing the health and explicit HTTP trigger endpoint.
5. Run `npx convex dev --once --typecheck enable`, `npm test`, `npm run test:convex`, `npm run test:convex:handlers`, and `pytest` in the worker before changes are merged. The handler suite uses local `convex-test` fixtures only; it does not need WorkOS or deployment credentials.

The CI workflow runs the UI build, workspace tests, Convex typecheck plus pure contract tests, worker tests, and deterministic benchmark matrix on every pull request.

The UI reads `NEXT_PUBLIC_CONVEX_URL`; worker-only `WORKER_CONVEX_URL` and `WORKER_CONVEX_TOKEN` must remain outside browser configuration. Set the worker token through `npx convex env set WORKER_TOKEN` and provide the same value only to the deployed worker service.

For every active profile that the worker is allowed to process, configure `WORKER_PROFILE_<PROFILE_ID>_SECRET_BASE64` and the exact immutable `WORKER_PROFILE_<PROFILE_ID>_VERSION`. Screen profiles are required for protected-page tiles: creating a web session queues a `web_tile` job, and the protected UI remains fail-closed until its worker-generated PNG has been bound to that session. The worker defaults to no inherited HTTP proxy; set `WORKER_HTTP_TRUST_ENV=true` only where an explicitly managed egress proxy is required.

For personalized files, configure carrier profiles that match the immutable source MIME: `image` profiles are only for JPEG, PNG, and WebP; `screen` profiles are only for PDF, DOCX, and PPTX. `structure` profiles support detector evidence and cannot issue a derivative. Issuance rejects converted output formats—the output remains the source's native MIME.

For direct leak evidence traced with a `screen` profile, PDF pages are rendered deterministically for candidate correlation. DOCX and PPTX retain native-structure provenance support and, by default, remain insufficient because no Office renderer is required by the worker. To opt in to visual candidate correlation, install a supported LibreOffice distribution in the worker image and set `WORKER_OFFICE_RENDERER_PATH` to its `soffice` executable (for example, the absolute `soffice`/`soffice.exe` path). If omitted, the worker detects `soffice` or `libreoffice` on `PATH`; it records the selected mode and external renderer version in raw evidence. You may set `WORKER_OFFICE_RENDER_TIMEOUT_SECONDS` from `1` to `300` (default `60`). The renderer receives a private copied artifact and writes only to an isolated temporary directory. A missing/unverifiable binary, timeout, conversion failure, malformed output, or failed PDF render fails closed to native-structure-only insufficient evidence; it never creates a visual score. Do not use a screenshot or PDF export solely to bypass this evidence policy—both are valid inputs only when they are the actual supplied evidence.

Trace intake validates the profile/evidence pair before a job is queued: image profiles accept JPEG/PNG/WebP only; screen profiles accept screenshots plus PDF/DOCX/PPTX; structure profiles accept PDF/DOCX/PPTX only. If it returns `TRACE_PROFILE_MIME_MISMATCH`, choose a compatible immutable profile instead of retrying the same pair.

Current screen-correlation results are intentionally recorded as `insufficient`, even when a repeated pattern produces a clear peak and candidate margin. The control plane retains that raw evidence, but withholds screen attribution until the immutable source-content/page matching layer is configured and verified. Image visual-code traces retain their separate frozen perceptual-fingerprint gate.

After installing or upgrading LibreOffice, record the distribution/version in your worker deployment manifest, then run `pytest tests/test_office_renderer.py tests/test_execution.py -q` from `services/watermark-worker`. The tests mock the external process and do not require LibreOffice locally; the full `pytest` suite remains the required pre-merge check.

The current image worker keeps its native metadata mapping and adds a deterministic CRC-protected visual `wmCode` fallback. It is measured on metadata-stripped images, controlled JPEG quality 60, and a 0.75 resize; it is not a neural detector and does not claim arbitrary crop, perspective, or camera recovery. A visual code is still only candidate evidence—the control plane requires the server mapping and normal fingerprint/threshold checks before attribution.

## Worker operation

The production container starts `traceanytong-worker run`. It performs lease maintenance before each claim, processes successful jobs without an artificial delay, waits after idle or lease-loss outcomes, and applies exponential backoff after failed outcomes. A lease loss is recoverable and is never reported as a new failure by the daemon. After `WORKER_MAX_CONSECUTIVE_FAILURES` failed outcomes (default `5`), the process exits with status `1` so the platform can restart it instead of hot-looping.

The bounded settings below are worker-only environment variables. Their defaults are suitable for a single general-purpose worker; tune them to the control-plane capacity, not to individual documents. The interval and initial failure backoff must be from `0.1` to `300` seconds, maximum failure backoff from `0.1` to `3600` seconds, and the failure limit from `1` to `100`.

```text
WORKER_IDLE_POLL_SECONDS=5
WORKER_FAILURE_BACKOFF_SECONDS=5
WORKER_MAX_FAILURE_BACKOFF_SECONDS=60
WORKER_MAX_CONSECUTIVE_FAILURES=5
```

For a one-off diagnostic claim, use `traceanytong-worker run-once`. To run the HTTP health and explicitly token-protected `/v1/worker/run-once` endpoint instead, override the image command with `traceanytong-worker serve`; configure `WORKER_HTTP_TRIGGER_TOKEN` only for that mode. Do not expose worker Convex credentials, profile secrets, or the HTTP trigger token to the browser or application logs.

## WorkOS AuthKit

Configure the same WorkOS client separately for each Convex deployment and its corresponding Next.js environment. `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, and `WORKOS_REDIRECT_URI` stay on the Next.js host. Set `WORKOS_CLIENT_ID` on Convex, then deploy so [`convex/auth.config.ts`](../convex/auth.config.ts) can validate AuthKit JWTs against WorkOS's published JWKS. Set `NEXT_PUBLIC_WORKOS_AUTH_ENABLED=true` only after both sides are configured; its default `false` guarantees the browser sends no token and protected control-plane calls remain fail-closed.

```powershell
npx convex env set WORKOS_CLIENT_ID client_your_development_client
npx convex dev --once --typecheck enable
```

Register the exact callback URI and browser origin in WorkOS before sign-in. For local development, use `http://localhost:3000/callback` as the callback URI, `http://localhost:3000` as the browser origin, and `http://localhost:3000/sign-in` as the application sign-in URL. Add `http://localhost:3000/` as the allowed WorkOS logout URI. The Next proxy passes the server-only `WORKOS_REDIRECT_URI` to AuthKit explicitly; do not add a public redirect-URI variable. The guarded `/sign-in` and `/sign-out` routes use fixed return destinations. Restart the Next server after changing any WorkOS variable. Until the client ID and server-side WorkOS settings are present, keep the public gate `false`; the UI intentionally sends no token and protected control-plane calls remain fail-closed.

After the first successful WorkOS sign-in, create the organization from the product onboarding screen using a unique slug. That account becomes the first active administrator. Administrators can invite viewer, issuer, and investigator roles; invitations are bound to the recipient's verified WorkOS email, expire after seven days, and are claimed once after sign-in. No role or organization is inferred from an email domain.

## Development demo bootstrap

The Convex development deployment can create a deterministic, non-PII demo organization, four role fixtures, and three immutable watermark profiles. This is not an authentication bypass: it is disabled unless both a development-mode marker and a server environment secret exist. Do not configure either `DEV_BOOTSTRAP_ENVIRONMENT` or `DEV_BOOTSTRAP_SECRET` in production.

In PowerShell, keep the secret in the current shell rather than command history, then run the bootstrap:

```powershell
$bootstrapSecret = Read-Host "Set a new development bootstrap secret"
npx convex env set DEV_BOOTSTRAP_ENVIRONMENT development
npx convex env set DEV_BOOTSTRAP_SECRET $bootstrapSecret
npx convex run devBootstrap:bootstrap (@{ secret = $bootstrapSecret } | ConvertTo-Json -Compress)
Remove-Variable bootstrapSecret
```

The fixture user subjects are `traceanytong-dev-demo:<role>` and their addresses end in `.invalid`; they are not user records for real people. Bootstrap returns only those subjects and profile IDs, never the configured secret. It is safe to run again: an existing fixture must match exactly or the operation fails rather than rewriting an immutable record.

To remove the empty demo organization, repeat the shell variable setup above and run `npx convex run devBootstrap:cleanup (@{ secret = $bootstrapSecret } | ConvertTo-Json -Compress)`. Cleanup is idempotent and deliberately refuses to delete documents, issuances, sessions, jobs, trace cases, evidence, or non-fixture users. The global immutable demo profiles remain for provenance reproducibility. After cleanup, remove both remote environment variables with `npx convex env remove DEV_BOOTSTRAP_SECRET` and `npx convex env remove DEV_BOOTSTRAP_ENVIRONMENT`.

## Operational recovery

Jobs have ten-minute leases. An expired running lease is returned to the retry queue. Preserve the original evidence object; create a new derived artifact rather than overwriting it. Investigate failed jobs from the Workers view and rerun only retryable jobs.

Trace jobs created before immutable candidate snapshots were introduced fail closed with `TRACE_CANDIDATE_SNAPSHOT_MISSING`. Recreate the trace case instead of attempting to attach newly selected candidates to that historical job.
