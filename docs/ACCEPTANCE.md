# Acceptance

The initial product accepts immutable source versions, issues anonymous personalized copies, creates bounded web sessions, preserves evidence, and returns explainable candidate ranking.

- `traceHandle` is opaque; `wmCode` uniquely maps to one trace identity.
- Duplicate job keys are idempotent; expired leases are recoverable.
- JPEG, PNG, WebP, PDF, DOCX and PPTX adapters reject unsupported inputs with typed errors and preserve valid native artifacts where supported.
- Watermark layer is fixed, uses `pointer-events: none`, and does not continuously animate.
- Trace results expose watermark, margin, fingerprint, geometric, structure and timeline evidence; unwatermarked or ambiguous input is never falsely attributed.
- Benchmark reports are deterministic and include attack and negative results.
- Public API authorization is centralized before storage download URLs are returned.

## Orchestrator-review public interface changes

- `devBootstrap:bootstrap` and `devBootstrap:cleanup` are development-only administrative mutations. They require both `DEV_BOOTSTRAP_ENVIRONMENT=development` and the exact server-side `DEV_BOOTSTRAP_SECRET`; neither variable may be configured in production. Bootstrap is deterministic and idempotent, while cleanup is idempotent and refuses to remove an organization that contains non-fixture work.
- Worker candidate submission now requires exactly one server-resolved issuance or web-session provenance binding. The service validates that binding, the opaque trace handle, immutable profile/protocol versions, raw evidence, score bounds, and profile-owned attribution thresholds before accepting a decision. Worker-supplied thresholds are not trusted.
- Worker job input now includes immutable `profileVersion` and the issuance timestamp as `createdAt`, so the `TraceIdentity` sent to a worker can be reconstructed without recipient identity data.
- `traceCases:list` is investigator/admin-only and uses a bounded opaque cursor. A web-session tile download is authorized for the session recipient (or an administrator) after organization membership is checked; its worker-only finalization mutation accepts only an existing storage object and never returns profile keys or derivation inputs.
- A trace case now selects an immutable profile and atomically queues a bounded `trace` job. Its leased worker input contains only the evidence URL plus at most 100 ready, same-profile anonymous candidate bindings: issuance candidates carry opaque trace handle, issuance timestamp, optional server-mapped code, and derived hash; screen candidates carry opaque trace handle and session timestamp. It contains no recipient identity. A candidate is recorded only after detector evidence matches one of those server-resolved bindings.
