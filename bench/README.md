# Benchmark Harness

The offline benchmark harness creates a deterministic fixture corpus and runs
image, rendered-document, and physical-channel *simulations*. It always emits
`report.json`, `summary.md`, `matrix.csv`, and `samples/`. The report records
raw image-comparison evidence (hashes, geometry, pHash similarity, PSNR, SSIM,
and artifact sizes) and keeps negatives `INSUFFICIENT`; it never invents an
attribution when no detector is present.

`report.json` also includes a `workerEvidence` matrix. It invokes the checked-out
worker's public image, screen, and native-structure APIs with deterministic
positive, negative, and deliberately ambiguous probes. It records raw detector
payloads plus the installed package and detector versions. A benchmark does not
have an authorized server-side issuance/session binding, so even matching image
or screen evidence remains `UNMEASURED`, while ambiguous/native-structure-only
evidence is `INSUFFICIENT`. These entries are regression coverage, not a claim
of production detector robustness or attribution accuracy.

```text
python -m bench.fixtures --output bench/fixtures
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest
```

For a clean checkout, the runner can generate the fixtures itself:

```text
python -m bench.runners.run --fixtures bench/fixtures --output bench/reports/latest --generate-fixtures
```

Document transforms in the artifact matrix are reproducible raster export/capture
simulations, not native DOCX/PPTX/PDF conversions. The separate `workerEvidence`
matrix tests local native-structure extraction on generated DOCX/PPTX and a
fixed PDF metadata fixture; it does not benchmark Office rendering. Real
screen/print-camera captures belong in `bench/datasets/physical/` when they are
available.

On GitHub Actions, the deterministic `bench/reports/ci` directory is published
as the `benchmark-report-ci` workflow artifact and retained for 30 days. It is
available from the individual workflow run's Artifacts section; generated
reports remain ignored by Git and are not committed.
