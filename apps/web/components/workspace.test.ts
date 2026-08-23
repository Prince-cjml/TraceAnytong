import { describe, expect, it } from "vitest";
import { traceCandidates } from "../lib/demo-data";
import { canManageTraceCases, liveTraceConsoleState, traceResultCopy, workspaceInitials, workspaceSessionAction } from "./workspace";

describe("trace result presentation", () => {
  it("keeps an insufficient decision explicitly non-attributive", () => {
    const copy = traceResultCopy("INSUFFICIENT");

    expect(copy.headline).toMatch(/not sufficient/i);
    expect(copy.body).toMatch(/No attribution is recorded/i);
    expect(copy.posture).toBe("No attribution recorded");
  });

  it("only describes a profile-threshold outcome for an attributable decision", () => {
    const copy = traceResultCopy("HIGH");

    expect(copy.body).toMatch(/immutable profile threshold/i);
    expect(copy.posture).toBe("Attribution threshold met");
  });
});

describe("workspace identity display", () => {
  it("derives compact initials without retaining fixture identity data", () => {
    expect(workspaceInitials("Northstar Bio")).toBe("NB");
    expect(workspaceInitials("Mara")).toBe("M");
    expect(workspaceInitials("   ")).toBe("?");
  });
});

describe("live trace access", () => {
  it("only exposes investigator trace controls to the roles authorized by the control plane", () => {
    expect(canManageTraceCases("investigator")).toBe(true);
    expect(canManageTraceCases("admin")).toBe(true);
    expect(canManageTraceCases("issuer")).toBe(false);
    expect(canManageTraceCases("viewer")).toBe(false);
    expect(canManageTraceCases(undefined)).toBe(false);
  });
});

describe("live trace terminal states", () => {
  it("never presents a failed worker case as an insufficient detector result", () => {
    expect(liveTraceConsoleState({ state: "failed", candidates: [] })).toBe("failed");
  });

  it("keeps active cases in processing and completed cases decision-bound", () => {
    expect(liveTraceConsoleState({ state: "queued", candidates: [] })).toBe("processing");
    expect(liveTraceConsoleState({ state: "processing", candidates: [] })).toBe("processing");
    expect(liveTraceConsoleState({ state: "complete", candidates: [] })).toBe("insufficient");
    expect(liveTraceConsoleState({ state: "complete", candidates: [traceCandidates[0]] })).toBe("result");
  });
});

describe("workspace session action", () => {
  it("keeps the public sign-in gate and an authenticated sign-out action mutually exclusive", () => {
    expect(workspaceSessionAction(false, false)).toBeNull();
    expect(workspaceSessionAction(true, false)).toEqual({ href: "/sign-in", label: "Sign in" });
    expect(workspaceSessionAction(false, true)).toEqual({ href: "/sign-out", label: "Sign out" });
    expect(workspaceSessionAction(true, true)).toEqual({ href: "/sign-out", label: "Sign out" });
  });
});
