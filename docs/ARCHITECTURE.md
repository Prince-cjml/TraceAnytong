# Architecture

The Next.js application provides issuer and investigator workflows. Convex is the control plane and blob store; external Python workers claim leased jobs and write derived artifacts and trace results. `packages/protocol` carries contracts between all layers.

```text
Next.js UI -> Convex control plane/storage -> watermark worker -> Convex storage
                                           <- trace results  <- detector/fingerprinter
```

Key modules:

- `convex/`: authorization, immutable versions, issuances, sessions, jobs and cases.
- `services/watermark-worker/`: format adapters, carriers, fingerprints and evidence fusion.
- `packages/web-watermark/`: non-interactive session-specific visual layer.
- `apps/web/`: operator UI, initially able to use deterministic fixtures.
- `bench/`: reproducible attacks, negatives and reports.
