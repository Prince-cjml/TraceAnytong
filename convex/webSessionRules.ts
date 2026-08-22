export type TileAccessRole = "viewer" | "issuer" | "investigator" | "admin";

/** A protected session tile belongs to its session recipient; admins may audit it. */
export function canAccessSessionTile(sessionUserId: string, requestingUserId: string, role: TileAccessRole): boolean {
  return sessionUserId === requestingUserId || role === "admin";
}
