# Runbook

## Local development

1. Install Node 20+ and Python 3.11+.
2. Copy `.env.example` to the relevant app/service environment file and configure Convex when deploying.
3. Run `npm install`, then `npm run dev` for the web app.
4. In `services/watermark-worker`, create a virtual environment and run `pip install -e '.[dev]'`; start with `uvicorn app.main:app --reload`.
5. Run `npm test` and `pytest` in the worker before changes are merged.

## Operational recovery

Jobs have ten-minute leases. An expired running lease is returned to the retry queue. Preserve the original evidence object; create a new derived artifact rather than overwriting it. Investigate failed jobs from the Workers view and rerun only retryable jobs.
