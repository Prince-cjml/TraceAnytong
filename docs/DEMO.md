# Demo guide

## Investigator UI

1. Open the Documents view and select **Issue protected copy**.
2. Generate the fixture issuance, which displays the anonymous-trace guarantee.
3. Open Trace, choose a leak fixture, and select **Preserve and analyze**.
4. Advance the processing timeline to inspect the ranked candidate, correlation margin, raw detector evidence, and immutable evidence metadata.
5. Use **Preview insufficient-evidence state** to confirm ambiguous evidence is not attributed.

## Worker API

Start the worker as described in the runbook, then request `GET /healthz`. The response reports protocol, carrier, detector, and worker versions. The adapter endpoints return typed unsupported-input errors rather than silently altering invalid files.

## Benchmark

```text
python -m pytest bench/tests -q
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest
```

Inspect `bench/reports/latest/report.json`, `summary.md`, `matrix.csv`, and `samples/`. The report distinguishes positive results from the negative corpus and must show zero confirmed negative attributions.
