import { describe, expect, it } from "vitest";
import { acceptedEvidenceLabel, normalizedArtifactMime } from "./trace-evidence-uploader";

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
});
