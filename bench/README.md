# Benchmark Harness

The offline benchmark harness creates a deterministic fixture corpus and runs
image, rendered-document, and physical-channel *simulations*. It always emits
`report.json`, `summary.md`, `matrix.csv`, and `samples/`. The report records
raw image-comparison evidence (hashes, geometry, pHash similarity, PSNR, SSIM,
and artifact sizes) and keeps negatives `INSUFFICIENT`; it never invents an
attribution when no detector is present.

```text
python -m bench.fixtures --output bench/fixtures
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest
```

For a clean checkout, the runner can generate the fixtures itself:

```text
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest --generate-fixtures
```

Document transforms are reproducible raster export/capture simulations, not
native DOCX/PPTX/PDF conversions. Real screen/print-camera captures belong in
`bench/datasets/physical/` when they are available.
