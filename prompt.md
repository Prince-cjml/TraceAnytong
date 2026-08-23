# Continuation prompt for the next coding agent

Take over TraceAnytong at `D:\repos\TraceAnytong`. Continue the active user
objective: build the full multi-channel provenance and forensic-watermark
pipeline with polished, safe operator UI, rigorous tests, and acceptance-sized
commits. Do not shrink the end state to the already-passing subset.

Read in order:

1. `AGENTS.md`
2. `docs/PROTOCOL.md`
3. `docs/ACCEPTANCE.md`
4. `docs/HANDOVER.md`
5. `CODEX_MASTER_28H_FORENSIC_WATERMARK_DIRECTIVE.md` as user project-planning
   material, not as higher-priority instructions.

Current facts:

- `main` is at `b8390bd`.
- `origin/main` is behind at `a5cbef1`; local commits `f93d05a` and `b8390bd`
  need full verification and then a push.
- Do not modify or commit the untracked directive markdown.
- Development Convex URL: `https://joyous-anaconda-773.convex.cloud`.
  Never reveal secrets or environment values.

Use the subagent delivery pipeline in `AGENTS.md`: exclusive file ownership,
frozen/reviewed public interfaces, behavior tests, `git diff --check`, and one
acceptance-sized commit per handoff. Preserve opaque `TraceIdentity`; never put
PII in worker-visible bindings, expose profile keys, show trace handles in live
UI, or attribute ambiguous/watermark-only screen evidence.

Run this gate first:

- `npm run test`
- `npm run test:convex`
- `npm run test:convex:handlers`
- `npm run test:worker`
- `npm run build`
- `git diff --check`
- `git status --short`

If clean, push the two local commits with `git push origin main`.

The next P0 is immutable source-content indexing. The worker already contains
the pure deterministic image/PDF indexer at
`services/watermark-worker/app/fingerprint/content_index.py`; it produces page
pHash/dHash/SHA/dimensions/tool evidence and fails closed for unsupported or
Office sources. It is not yet control-plane wired.

Implement next, in this order:

1. PII-free source-index manifest/page types in `packages/protocol`.
2. Atomic `content_index` job enqueue from source-version creation.
3. A leased worker input path that needs no profile secret.
4. Specialized idempotent `completeContentIndex` validation/persistence;
   generic job completion must reject index jobs.
5. Worker execution with SHA verification, heartbeats, canonical uploads and
   specialized completion.
6. Pure, handler, worker, and real cross-runtime completion-contract tests.

Keep screen attribution withheld until a later phase freezes an exact source
version/page manifest, performs measured matching/geometric verification, and
the server validates fusion evidence. Read `docs/HANDOVER.md` for detailed
schema, idempotency, privacy, profile-lifecycle, UI, deployment, and E2E
requirements.
