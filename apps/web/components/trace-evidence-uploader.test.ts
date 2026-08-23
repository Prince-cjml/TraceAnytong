import { describe, expect, it } from "vitest";
import {
  acceptedEvidenceLabel,
  normalizedArtifactMime,
  projectAuthorizedDocumentChoices,
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
