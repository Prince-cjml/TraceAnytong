# Acceptance

The initial product accepts immutable source versions, issues anonymous personalized copies, creates bounded web sessions, preserves evidence, and returns explainable candidate ranking.

- `traceHandle` is opaque; `wmCode` uniquely maps to one trace identity.
- Duplicate job keys are idempotent; expired leases are recoverable.
- JPEG, PNG, WebP, PDF, DOCX and PPTX adapters reject unsupported inputs with typed errors and preserve valid native artifacts where supported.
- Watermark layer is fixed, uses `pointer-events: none`, and does not continuously animate.
- Trace results expose watermark, margin, fingerprint, geometric, structure and timeline evidence; unwatermarked or ambiguous input is never falsely attributed.
- Benchmark reports are deterministic and include attack and negative results.
- Public API authorization is centralized before storage download URLs are returned.
