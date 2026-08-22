# TraceAnytong Protocol v0.1

`packages/protocol` is the source of truth. A `traceHandle` is a random, opaque 128-bit identifier and must never encode a user, email, document ID, or other PII.

```ts
export type TraceScope = "issuance" | "web_session";
export interface TraceIdentity {
  traceHandle: string;
  scope: TraceScope;
  profileVersion: string;
  createdAt: number;
}
export interface CarrierBinding {
  traceHandle: string;
  carrier: "image" | "screen" | "structure";
  carrierVersion: string;
  wmCode?: number;
  keyVersion: string;
}
```

Watermark profiles are immutable and versioned. Images carry a unique `wmCode` mapped server-side to a trace handle. Documents and protected web views use a deterministic, keyed, repeated screen pattern and candidate-matched correlation. Detectors return raw scores, margins, geometry, fingerprint, structure, timeline evidence, and warnings; ambiguous results are `INSUFFICIENT`.

All artifact and evidence records retain protocol, profile, carrier, model, detector, fingerprint, key, and worker versions. Evidence bytes are immutable and SHA-256 hashed before processing.
