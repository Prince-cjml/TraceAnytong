import { describe, expect, it } from "vitest";
import {
  acceptedEvidenceLabel,
  compatibleProfilesForEvidenceMime,
  isProfileCompatibleWithEvidenceMime,
  normalizedArtifactMime,
  projectAuthorizedDocumentChoices,
  selectCompatibleEvidenceProfile,
  selectedAuthorizedDocumentId,
} from "./trace-evidence-uploader";

describe("authenticated trace evidence intake", () => {
  it("describes supported artifact families without exposing detector internals", () => {
    expect(acceptedEvidenceLabel("image/png")).toBe("Image evidence");
    expect(acceptedEvidenceLabel("application/pdf")).toBe("PDF evidence");
    expect(acceptedEvidenceLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("DOCX evidence");
    expect(acceptedEvidenceLabel("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("PPTX evidence");
  });

  it("normalizes extension-only browser uploads but refuses unsupported formats", () => {
    expect(normalizedArtifactMime({ name: "evidence.DOCX", type: "" } as File)).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(normalizedArtifactMime({ name: "animated.gif", type: "image/gif" } as File)).toBeNull();
    expect(normalizedArtifactMime({ name: "misleading.png", type: "image/gif" } as File)).toBeNull();
  });

  it("only offers active carriers that can inspect the selected evidence family", () => {
    const profiles = [
      { profileId: "image-v1", carrier: "image" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
      { profileId: "screen-v1", carrier: "screen" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
      { profileId: "structure-v1", carrier: "structure" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
    ];

    expect(isProfileCompatibleWithEvidenceMime(profiles[0], "image/jpeg")).toBe(true);
    expect(isProfileCompatibleWithEvidenceMime(profiles[1], "image/jpeg")).toBe(true);
    expect(isProfileCompatibleWithEvidenceMime(profiles[2], "image/jpeg")).toBe(false);
    expect(compatibleProfilesForEvidenceMime(profiles, "image/png").map((profile) => profile.profileId)).toEqual(["image-v1", "screen-v1"]);
    expect(compatibleProfilesForEvidenceMime(profiles, "application/pdf").map((profile) => profile.profileId)).toEqual(["screen-v1", "structure-v1"]);
    expect(compatibleProfilesForEvidenceMime(profiles, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").map((profile) => profile.profileId)).toEqual(["screen-v1", "structure-v1"]);
    expect(compatibleProfilesForEvidenceMime(profiles, "application/vnd.openxmlformats-officedocument.presentationml.presentation").map((profile) => profile.profileId)).toEqual(["screen-v1", "structure-v1"]);
    expect(compatibleProfilesForEvidenceMime(profiles, "text/plain")).toEqual([]);
  });

  it("preselects only a singular compatible profile and requires an explicit version choice otherwise", () => {
    const profiles = [
      { profileId: "image-v1", carrier: "image" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
      { profileId: "screen-v1", carrier: "screen" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
      { profileId: "structure-v1", carrier: "structure" as const, protocolVersion: "0.1", profileVersion: "1", detectorVersion: "1" },
    ];

    expect(selectCompatibleEvidenceProfile(profiles, "image/png", "screen-v1")?.profileId).toBe("screen-v1");
    expect(selectCompatibleEvidenceProfile(profiles, "image/png", "structure-v1")).toBeUndefined();
    expect(selectCompatibleEvidenceProfile(profiles, "application/pdf", "image-v1")).toBeUndefined();
    expect(selectCompatibleEvidenceProfile(profiles, "application/pdf", "structure-v1")?.profileId).toBe("structure-v1");
    expect(selectCompatibleEvidenceProfile([profiles[0]], "image/png", "")).toEqual(profiles[0]);
    expect(selectCompatibleEvidenceProfile(profiles, "text/plain", "screen-v1")).toBeUndefined();
    expect(selectCompatibleEvidenceProfile(undefined, "image/png", "")).toBeUndefined();
  });

  it("projects only authorized source-document context for the optional selector", () => {
    expect(projectAuthorizedDocumentChoices([
      { _id: "document_opaque_a", title: "Growth strategy", classification: "Restricted" },
      { _id: "document_opaque_b", title: "Field brief", classification: "Internal" },
    ])).toEqual([
      { documentId: "document_opaque_a", label: "Growth strategy · Restricted" },
      { documentId: "document_opaque_b", label: "Field brief · Internal" },
    ]);
    expect(projectAuthorizedDocumentChoices(undefined)).toEqual([]);
  });

  it("submits a suspected document ID only when it is still in the authorized selector", () => {
    const choices = projectAuthorizedDocumentChoices([
      { _id: "document_opaque_a", title: "Growth strategy", classification: "Restricted" },
    ]);
    expect(selectedAuthorizedDocumentId(choices, "document_opaque_a")).toBe("document_opaque_a");
    expect(selectedAuthorizedDocumentId(choices, "stale_or_untrusted_document")).toBeUndefined();
    expect(selectedAuthorizedDocumentId([], "document_opaque_a")).toBeUndefined();
  });
});
