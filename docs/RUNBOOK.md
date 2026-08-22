# Runbook

## Local development

1. Install Node 20+ and Python 3.11+.
2. Copy `.env.example` to the relevant app/service environment file. Run `npx convex dev --once` to bind the local project, generate `convex/_generated`, and deploy the schema to the configured development deployment.
3. Run `npm install`, then `npm run dev` for the web app.
4. In `services/watermark-worker`, create a virtual environment and run `pip install -e '.[dev]'`; start with `uvicorn app.main:app --reload`.
5. Run `npx convex dev --once --typecheck enable`, `npm test`, and `pytest` in the worker before changes are merged.

The CI workflow runs the UI build, workspace tests, standalone Convex typecheck, worker tests, and deterministic benchmark matrix on every pull request.

The UI reads `NEXT_PUBLIC_CONVEX_URL`; worker-only `CONVEX_URL` and `WORKER_TOKEN` must remain outside browser configuration. Set the worker token through `npx convex env set WORKER_TOKEN` and provide the same value only to the deployed worker service.

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
