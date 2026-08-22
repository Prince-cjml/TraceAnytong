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

## Subagent delivery pipeline

1. The orchestrator assigns a bounded workstream with exclusive file ownership, frozen interfaces, acceptance criteria, and verification commands before work starts.
2. Read this file, `docs/PROTOCOL.md`, and `docs/ACCEPTANCE.md` before editing. Report any interface conflict before changing shared contracts.
3. Work only in assigned paths. Do not stage, commit, or reformat another workstream's files; leave shared integration to the orchestrator.
4. Prefer deterministic unit and contract tests. Add an end-to-end test only when the required external configuration is available and avoid embedding credentials or PII in fixtures.
5. Keep progress updates concise: state the current result, blocker, or interface decision. Do not claim completion without the required verification output.
6. Before handoff, run the assigned checks, run `git diff --check`, stage only owned paths, and make one acceptance-sized commit. If the shared Git index is unavailable, leave files unstaged and report the exact paths and checks instead.
7. Every handoff must state: changed files, public interface changes, tests run and results, known limitations, and commit hash. The orchestrator is responsible for integration and final acceptance.
