# TraceAnytong continuation handover

## Current checkout

- Repository: `D:\repos\TraceAnytong`, branch `main`.
- Local HEAD: `b8390bd fix(web): redact live trace handles`.
- `origin/main` is `a5cbef1`; local-only commits are `f93d05a` and `b8390bd`.
- Development Convex: `https://joyous-anaconda-773.convex.cloud`. Never print
  or commit secrets from `.env.local` or worker environments.
- `CODEX_MASTER_28H_FORENSIC_WATERMARK_DIRECTIVE.md` is user planning material.
  It is the sole untracked file and must remain unmodified/uncommitted.

Read `AGENTS.md`, `docs/PROTOCOL.md`, and `docs/ACCEPTANCE.md` before editing.
`packages/protocol` is the source of truth. Do not redefine `TraceIdentity`,
put PII into bindings, expose keys, or force an ambiguous attribution.

The required subagent delivery pipeline is in `AGENTS.md`: bounded exclusive
paths, frozen interfaces, tests and `git diff --check`, one acceptance-sized
commit per handoff. Agents were stopped only to create this handover; no partial
worktree changes are known.

## Recent committed work

| Commit | Result |
| --- | --- |
| `3320ef1` | Image transformed evidence needs visual code, a unique frozen issuance, and frozen perceptual support. |
| `a8f229b` | Optional no-shell LibreOffice trace renderer with native-structure fail-closed fallback. |
| `bf6d8ed` | Real frozen Convex image snapshot -> real worker -> real handler contract test. |
| `411ca3e` / `7d099d0` | UI and server reject incompatible trace evidence/profile pairs. |
| `4c85263` / `6259f28` | Worker and server retain screen correlation but withhold screen attribution pending content matching. |
| `c197411` | Forms require explicit profile selection when multiple compatible versions exist. |
| `a5cbef1` | Authorized source context freezes document scope and limits issuance candidates to its immutable versions. Selected screen traces exclude unbound sessions. |
| `f93d05a` | Pure image/PDF source-page indexer; unsupported/corrupt/Office sources are explicitly unindexed. |
| `b8390bd` | Live UI redacts opaque trace handles. |

Everything through `a5cbef1` is pushed. The deployment contains that schema set
because `npx convex dev --once --typecheck enable` passed after it. Verify and
push `f93d05a` and `b8390bd` next.

## Verification evidence

Before the final two local commits, the all-up local gate passed: 43 web tests,
27 pure Convex/typecheck tests, 12 Convex handler tests, 68 worker tests, and a
production web build. `f93d05a` additionally passed eight focused source-index
tests plus a full worker run; `b8390bd` includes focused workspace tests. Run
the whole gate again before pushing local-only commits.

## Remaining P0: real immutable content matching

The intended flow is leak evidence -> content match -> relevant candidate
snapshot -> watermark ranking -> evidence fusion -> investigator result.

Current behavior is safe but incomplete:

1. Selected document context scopes issuance candidates but does not prove byte,
   version, page, or geometry matching.
2. Image traces use a frozen derived-artifact dHash gate after visual code
   recovery. It is issuance-specific evidence, not general source matching.
3. `versionPages` has no worker/control-plane writer.
4. Screen/PDF/DOCX/PPTX are deliberately insufficient until real matching.
5. Sessions have no content/version binding and cannot join selected-document
   traces.

Never weaken the current screen safety gate for a demo attribution.

## Accepted next public-contract increment: content-index jobs

Implement in acceptance-sized pieces. This is a reviewed public
interface/schema change.

### Contract and source versions

Define PII-free index manifest/page-record types in `packages/protocol` before
Convex/Python wiring. `documents:addVersion` must atomically enqueue exactly one
deterministic CPU `content_index` job.

Add `jobs.versionId` and source-index lifecycle data, for example
`contentIndexJobId`, `contentIndexState` (queued/processing/ready/failed),
`contentIndexVersion`, and optional manifest storage ID/SHA. The server must
name initial byte-integrity metadata and derive its SHA prefix; browser-supplied
fingerprint metadata is not a trusted index. Use a deterministic job key such
as `sha256("content-index|<versionId>|source-page-index-v1")`.

### Leased worker input and specialized completion

`jobs:getWorkerInput` must support leased `content_index` work without profile
lookup or secret material. Return only source URL, MIME, expected SHA, opaque
version ID, index version, and bounded limits.

Create `jobs:completeContentIndex`; generic `jobs:complete` must reject index
jobs. The specialized mutation verifies active running lease, exact job/version/
source binding, source SHA, fixed versions, bounded dense zero-based pages,
hash/dHash/pHash syntax, paired feature storage/hash, dimensions, and an
allowlisted PII-free payload. It must be exact-retry-idempotent and conflict on
changed manifest/page/renderer/storage data. Atomically insert immutable
`versionPages`, mark index ready, bind compact manifest, and finish the job.
Lost-lease uploads never become attached; terminal failure marks index failed.

### Existing worker indexer

`services/watermark-worker/app/fingerprint/content_index.py` is committed.
`index_source_content(Artifact)` supports JPEG/PNG/WebP (one page) and fixed
144-DPI PDF pages. Each page has DCT pHash, dHash, canonical page SHA-256,
dimensions, tool versions and raw deterministic evidence. DOCX/PPTX,
encrypted/corrupt/unsupported inputs return `unindexed` only.

Worker execution must branch before profile-secret resolution, validate source
SHA, heartbeat around every I/O boundary, upload canonical previews/manifest,
and call specialized completion. The indexer uses one-based `pageNumber`; the
persistence contract should deliberately convert to dense zero-based `pageIndex`
or rename both consistently. Do not claim ORB/RANSAC geometry exists yet.

## Later work after source pages are indexed

Freeze exact document version, source SHA, manifest identity, and page
projections at trace creation. Filter issuances to that frozen version, bind
sessions to immutable content/version, give worker only frozen page material,
and persist validated page-match/fingerprint/geometric evidence. Only then may
profile policy require watermark + fingerprint + margin (and geometry where
applicable) to lift the screen gate. Rank two remains non-attributive.

The later UI card must expose only bounded status/page-count/normalized geometry
statistics/warnings. Never send source/version IDs, URLs, hashes, storage IDs,
recipient data, candidate vectors, or trace handles merely for rendering.

## Profile lifecycle backlog

The dev `demo-image-v1` reports image/detector/model v1 while the worker emits
v2 metadata. Candidate recording does not strictly validate all evidence
metadata against a frozen profile manifest, and retired profiles cannot trace
historical artifacts. The future design needs immutable manifests separated from
an audited active-to-retired lifecycle, full job manifest stamps, exact worker
dispatch, server-derived metadata, and distinct issuable vs traceable views.
Do not rewrite v1; preserve its traceability while adding a versioned migration.

## Required commands

- `npm run test`
- `npm run test:convex`
- `npm run test:convex:handlers`
- `npm run test:worker`
- `npm run build`
- `git diff --check`
- `git status --short`

For Convex schema/function changes run `npx convex dev --once --typecheck enable`.
Then push verified commits with `git push origin main`. A transient Next `.next`
lock can occur: wait and retry, do not delete it blindly. Pytest may display
only progress dots despite a successful exit in this desktop environment.

## External validation still required

Configure matching WorkOS Next/Convex credentials, restart a worker from current
code with worker-only profile secrets, and exercise upload -> source version ->
index -> issuance/session -> worker completion -> leak evidence -> trace case ->
investigator result. Record actual tool/package/model versions and benchmarks;
never call unmeasured transforms/camera captures/Office rendering attributable.

## Immediate continuation order

1. Inspect status and `git log origin/main..HEAD`; run the full command gate.
2. Push `f93d05a` and `b8390bd` only when clean. They need no extra Convex deploy.
3. Implement protocol + Convex `content_index`, then worker execution against
   exact functions.
4. Add a real worker-output -> specialized Convex completion contract test.
5. Only then begin frozen version/page matching and evidence fusion.
