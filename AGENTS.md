# Shared Rules

1. Read `docs/PROTOCOL.md` and `docs/ACCEPTANCE.md` first.
2. `packages/protocol` is the source of truth.
3. Do not silently redefine `TraceIdentity` or add embedded PII.
4. Public interface changes require orchestrator review.
5. Keep commits acceptance-sized and include tests with behavior.
6. Record external model/checkpoint versions and use deterministic fixtures.
7. Update `docs/RUNBOOK.md` when setup changes.
8. Do not change another workstream's files unless assigned.
9. Return raw detector evidence; do not hide it behind an unexplained scalar.
10. Never force attribution when evidence is ambiguous.
