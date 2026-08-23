import { describe, expect, it } from "vitest";
import {
  compatibleProfilesForSourceMime,
  documentIntakeDescriptor,
  hasExplicitRecipientReference,
  isProfileCompatibleWithSourceMime,
  selectCompatibleSourceProfile,
} from "./document-intake";

describe("document intake descriptor", () => {
  it("maps supported native sources to an immutable-preserving output format", () => {
    expect(documentIntakeDescriptor({ name: "Board Readout.pptx", type: "" })).toEqual({
      title: "Board Readout",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      outputFormat: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(documentIntakeDescriptor({ name: "source.pdf", type: "application/pdf" })?.mime).toBe("application/pdf");
    expect(documentIntakeDescriptor({ name: "photo.jpg", type: "image/jpeg" })?.outputFormat).toBe("image/jpeg");
  });

  it("rejects artifact families absent from the worker adapter registry", () => {
    expect(documentIntakeDescriptor({ name: "notes.txt", type: "text/plain" })).toBeNull();
    expect(documentIntakeDescriptor({ name: "archive.zip", type: "application/zip" })).toBeNull();
    expect(documentIntakeDescriptor({ name: "misleading.png", type: "image/gif" })).toBeNull();
  });
});

describe("protected-copy guard", () => {
  it("requires an explicitly supplied opaque recipient reference before issuing", () => {
    expect(hasExplicitRecipientReference("")).toBe(false);
    expect(hasExplicitRecipientReference("   ")).toBe(false);
    expect(hasExplicitRecipientReference("k5716bhsjqm7194jeqhbg9gk1h8czxvy")).toBe(true);
  });

  it("only offers the carrier implemented for the selected native source", () => {
    const profiles = [
      { profileId: "image-v1", carrier: "image" as const, profileVersion: "1" },
      { profileId: "screen-v1", carrier: "screen" as const, profileVersion: "1" },
      { profileId: "structure-v1", carrier: "structure" as const, profileVersion: "1" },
    ];

    expect(isProfileCompatibleWithSourceMime(profiles[0], "image/jpeg")).toBe(true);
    expect(isProfileCompatibleWithSourceMime(profiles[1], "image/jpeg")).toBe(false);
    expect(compatibleProfilesForSourceMime(profiles, "image/png").map((profile) => profile.profileId)).toEqual(["image-v1"]);
    expect(compatibleProfilesForSourceMime(profiles, "application/pdf").map((profile) => profile.profileId)).toEqual(["screen-v1"]);
    expect(compatibleProfilesForSourceMime(profiles, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").map((profile) => profile.profileId)).toEqual(["screen-v1"]);
    expect(compatibleProfilesForSourceMime(profiles, "application/vnd.openxmlformats-officedocument.presentationml.presentation").map((profile) => profile.profileId)).toEqual(["screen-v1"]);
  });

  it("does not treat detector-only or unknown artifact profiles as issuable", () => {
    const profiles = [{ profileId: "structure-v1", carrier: "structure" as const, profileVersion: "1" }];
    expect(compatibleProfilesForSourceMime(profiles, "application/pdf")).toEqual([]);
    expect(compatibleProfilesForSourceMime(profiles, "text/plain")).toEqual([]);
  });

  it("preselects only a singular compatible profile and never inherits profile query order", () => {
    const image = { profileId: "image-v1", carrier: "image" as const, profileVersion: "1" };
    const imageV2 = { profileId: "image-v2", carrier: "image" as const, profileVersion: "2" };
    const screen = { profileId: "screen-v1", carrier: "screen" as const, profileVersion: "1" };

    expect(selectCompatibleSourceProfile([image, screen], "image/png", "")?.profileId).toBe("image-v1");
    expect(selectCompatibleSourceProfile([image, imageV2, screen], "image/png", "")).toBeUndefined();
    expect(selectCompatibleSourceProfile([image, imageV2, screen], "image/png", "image-v2")?.profileId).toBe("image-v2");
    expect(selectCompatibleSourceProfile([screen], "image/png", "screen-v1")).toBeUndefined();
    expect(selectCompatibleSourceProfile(undefined, "image/png", "image-v1")).toBeUndefined();
  });
});
