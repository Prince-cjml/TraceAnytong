import { describe, expect, it } from "vitest";
import { acceptedEvidenceLabel } from "./trace-evidence-uploader";

describe("authenticated trace evidence intake", () => {
  it("describes supported artifact families without exposing detector internals", () => {
    expect(acceptedEvidenceLabel("image/png")).toBe("Image evidence");
    expect(acceptedEvidenceLabel("application/pdf")).toBe("PDF evidence");
    expect(acceptedEvidenceLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("DOCX evidence");
    expect(acceptedEvidenceLabel("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("PPTX evidence");
  });
});
