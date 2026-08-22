# Runbook

## Local development

1. Install Node 20+ and Python 3.11+.
2. Copy `.env.example` to the relevant app/service environment file. Run `npx convex dev --once` to bind the local project, generate `convex/_generated`, and deploy the schema to the configured development deployment.
3. Run `npm install`, then `npm run dev` for the web app.
4. In `services/watermark-worker`, create a virtual environment and run `pip install -e '.[dev]'`; start with `uvicorn app.main:app --reload`.
5. Run `npx convex dev --once --typecheck enable`, `npm test`, and `pytest` in the worker before changes are merged.

The CI workflow runs the UI build, workspace tests, standalone Convex typecheck, worker tests, and deterministic benchmark matrix on every pull request.

The UI reads `NEXT_PUBLIC_CONVEX_URL`; worker-only `CONVEX_URL` and `WORKER_TOKEN` must remain outside browser configuration. Set the worker token through `npx convex env set WORKER_TOKEN` and provide the same value only to the deployed worker service.

## Operational recovery

Jobs have ten-minute leases. An expired running lease is returned to the retry queue. Preserve the original evidence object; create a new derived artifact rather than overwriting it. Investigate failed jobs from the Workers view and rerun only retryable jobs.
