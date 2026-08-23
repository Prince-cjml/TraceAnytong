# Demo guide

The interactive demo uses the real control plane. Fixture cards rendered when
there is no authenticated session are deliberately non-operational and cannot
create, download, or trace files.

1. Configure WorkOS and Convex as described in [RUNBOOK.md](RUNBOOK.md), then
   bootstrap the development fixtures. The fixture administrator display name
   is `tongtong`.
2. Start `traceanytong-worker run` with the worker token and the required
   immutable profile secrets. Wait for its normal lease loop to be healthy.
3. Sign in, preserve a PNG/JPEG/WebP/PDF/DOCX/PPTX source in **Documents**, and
   select a recipient plus a compatible profile to queue a protected copy.
4. Wait for both the source index and personalization jobs. The protected copy
   appears in the **Protected copies** registry only after the worker has bound
   its immutable derivative.
5. Click **Download copy**. The control plane authorizes the user before
   minting the storage URL and records the download only for a successful
   authorization.
6. As an investigator or administrator, use **Trace** to preserve actual leak
   evidence and follow the case queue. Image attribution remains subject to
   the server’s frozen fingerprint and margin checks. Screen correlation is
   retained as raw evidence but intentionally remains insufficient until the
   later immutable page-matching phase.

Never use the browser fixture preview as proof that a protected file was
generated or that attribution occurred.
