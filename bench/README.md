# Benchmark Harness

Run deterministic fixtures through the attack matrix and retain `report.json`, `summary.md`, `matrix.csv`, and sample artifacts. Negatives must never yield confirmed attribution.

```text
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest
```
