import { describe, expect, it } from "vitest";
import { documentIntakeDescriptor, hasExplicitRecipientReference } from "./document-intake";

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
  });
});

describe("protected-copy guard", () => {
  it("requires an explicitly supplied opaque recipient reference before issuing", () => {
    expect(hasExplicitRecipientReference("")).toBe(false);
    expect(hasExplicitRecipientReference("   ")).toBe(false);
    expect(hasExplicitRecipientReference("k5716bhsjqm7194jeqhbg9gk1h8czxvy")).toBe(true);
  });
});
