/**
 * Deterministic, non-production fixture identities used only by devBootstrap.
 * The .invalid addresses are reserved, non-deliverable names (RFC 2606), not
 * contact data. They exist solely because the current users schema requires an
 * email-shaped string.
 */
export const DEMO_ORGANIZATION = {
  name: "TraceAnytong development demo",
  slug: "traceanytong-dev-demo",
} as const;

export const DEMO_USERS = [
  { authSubject: "traceanytong-dev-demo:viewer", displayName: "Demo viewer", email: "viewer@traceanytong-demo.invalid", role: "viewer" as const },
  { authSubject: "traceanytong-dev-demo:issuer", displayName: "Demo issuer", email: "issuer@traceanytong-demo.invalid", role: "issuer" as const },
  { authSubject: "traceanytong-dev-demo:investigator", displayName: "Demo investigator", email: "investigator@traceanytong-demo.invalid", role: "investigator" as const },
  { authSubject: "traceanytong-dev-demo:admin", displayName: "tongtong", email: "admin@traceanytong-demo.invalid", role: "admin" as const },
] as const;

export type DemoProfileFixture = {
  profileId: string;
  carrier: "image" | "screen" | "structure";
  protocolVersion: "0.1";
  profileVersion: string;
  carrierVersion: string;
  modelVersion?: string;
  detectorVersion: string;
  strength: number;
  tileConfig?: { tileSize: number; alpha: number };
  keyVersion: string;
  thresholds: { minimumConfidence: number; minimumMargin: number };
  status: "active";
};

/** Profile IDs are versions: bootstrap never patches or redefines them. */
export const DEMO_PROFILES: readonly DemoProfileFixture[] = [
  {
    profileId: "demo-image-v1", carrier: "image", protocolVersion: "0.1", profileVersion: "1.0.0", carrierVersion: "image-code-v1",
    modelVersion: "deterministic-fallback-v1", detectorVersion: "image-code-detector-v1", strength: 0.12,
    keyVersion: "demo-key-v1", thresholds: { minimumConfidence: 0.8, minimumMargin: 0.05 }, status: "active",
  },
  {
    profileId: "demo-screen-v1", carrier: "screen", protocolVersion: "0.1", profileVersion: "1.0.0", carrierVersion: "screen-tile-v1",
    detectorVersion: "screen-tile-detector-v1", strength: 0.12, tileConfig: { tileSize: 256, alpha: 0.12 },
    keyVersion: "demo-key-v1", thresholds: { minimumConfidence: 0.8, minimumMargin: 0.05 }, status: "active",
  },
  {
    profileId: "demo-structure-v1", carrier: "structure", protocolVersion: "0.1", profileVersion: "1.0.0", carrierVersion: "structure-v1",
    detectorVersion: "structure-detector-v1", strength: 0, keyVersion: "demo-key-v1",
    thresholds: { minimumConfidence: 0.8, minimumMargin: 0.05 }, status: "active",
  },
];

export function profileMatchesFixture(existing: Record<string, unknown>, fixture: DemoProfileFixture): boolean {
  return existing.profileId === fixture.profileId
    && existing.carrier === fixture.carrier
    && existing.protocolVersion === fixture.protocolVersion
    && existing.profileVersion === fixture.profileVersion
    && existing.carrierVersion === fixture.carrierVersion
    && existing.modelVersion === fixture.modelVersion
    && existing.detectorVersion === fixture.detectorVersion
    && existing.strength === fixture.strength
    && existing.keyVersion === fixture.keyVersion
    && existing.status === fixture.status
    && JSON.stringify(existing.tileConfig ?? null) === JSON.stringify(fixture.tileConfig ?? null)
    && JSON.stringify(existing.thresholds) === JSON.stringify(fixture.thresholds);
}

export function userMatchesFixture(existing: Record<string, unknown>, fixture: (typeof DEMO_USERS)[number]): boolean {
  return existing.authSubject === fixture.authSubject
    && existing.displayName === fixture.displayName
    && existing.email === fixture.email
    && existing.role === fixture.role
    && existing.status === "active";
}

/** Keep secret validation separately testable and do not supply a default secret. */
export function assertDevelopmentBootstrapAccess(
  providedSecret: string,
  configuredSecret: string | undefined,
  environment: string | undefined,
): void {
  if (!configuredSecret || environment !== "development") throw new Error("DEV_BOOTSTRAP_DISABLED");
  if (!providedSecret || providedSecret !== configuredSecret) throw new Error("FORBIDDEN");
}
