# TraceAnytong

TraceAnytong is a multi-channel provenance and forensic watermarking platform. It issues anonymous, recipient-specific derivatives; serves protected web content with an inert visual carrier; and provides an investigator console that combines watermark, content, geometry, structure, and timeline evidence.

## Included foundation

- Convex-first control-plane schema, authorization helpers, immutable versions, issuances, bounded web sessions, leased jobs, trace cases, and storage contracts.
- Python worker with image-code and screen-tile carriers, format adapters, fingerprints, conservative evidence fusion, and a health endpoint.
- Next.js investigator UI with document issuance and evidence-trace flows backed by deterministic fixtures.
- Reproducible benchmark matrix, including negative corpus and digital/document/physical-channel simulations.

## Run locally

```text
npm install
npm run dev
```

In a second terminal:

```text
cd services/watermark-worker
python -m pip install -e ".[dev]"
python -m uvicorn app.main:app --reload
```

Configure `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_URL`, and `WORKER_TOKEN` from `.env.example` before connecting a Convex deployment. Run `npm run test`, `python -m pytest services/watermark-worker/tests -q`, and `python -m pytest bench/tests -q` before release.

See [the runbook](docs/RUNBOOK.md) and [demo guide](docs/DEMO.md).
