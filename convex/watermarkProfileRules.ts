export type ScreenProfileCandidate = {
  profileId: string;
  profileVersion: string;
  carrier: "image" | "screen" | "structure";
  status: "active" | "retired";
};

export type ActiveScreenProfileResult =
  | { available: true; profileId: string; profileVersion: string }
  | { available: false; reason: "missing" | "ambiguous" };

/** A protected route has no safe profile choice unless the registry is singular. */
export function selectActiveScreenProfile(profiles: readonly ScreenProfileCandidate[]): ActiveScreenProfileResult {
  const candidates = profiles.filter((profile) => profile.status === "active" && profile.carrier === "screen");
  if (candidates.length !== 1) return { available: false, reason: candidates.length ? "ambiguous" : "missing" };
  return { available: true, profileId: candidates[0].profileId, profileVersion: candidates[0].profileVersion };
}
