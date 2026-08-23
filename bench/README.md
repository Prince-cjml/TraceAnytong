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

The worker matrix separately records screen candidate-pair evidence after JPEG
60, a 50% retained crop, and a 0.75 resize. The first two currently preserve a
measured separation in the deterministic fixture; the resize probe intentionally
records `INSUFFICIENT` because this detector has no scale normalization and the
measured scores do not separate the expected candidate. It also exercises actual
personalized PDF native-structure extraction alongside DOCX and PPTX. None of
these measurements is an attribution claim or a physical-capture robustness
guarantee.

The PDF adapter's underlying library generates a fresh trailer ID on each
write. For the generated PDF fixture only, the worker matrix removes that
non-carrier trailer field before collecting structural evidence and records the
normalization in `rawDetectorEvidence.benchmarkNormalization`; this makes the
raw source hash reproducible. Uploaded evidence is never normalized this way.

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
