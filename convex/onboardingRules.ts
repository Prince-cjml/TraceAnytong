export type InvitationRole = "viewer" | "issuer" | "investigator";

export function normalizedOrganizationName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) throw new Error("INVALID_ORGANIZATION_NAME");
  return normalized;
}

export function normalizedOrganizationSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length > 64) throw new Error("INVALID_ORGANIZATION_SLUG");
  return normalized;
}

export function normalizedDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) throw new Error("INVALID_DISPLAY_NAME");
  return normalized;
}

export function normalizedInvitationEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("INVALID_INVITATION_EMAIL");
  return normalized;
}

export function assertInvitationRole(role: string): asserts role is InvitationRole {
  if (role !== "viewer" && role !== "issuer" && role !== "investigator") throw new Error("INVALID_INVITATION_ROLE");
}
