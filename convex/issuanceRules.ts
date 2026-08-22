export type RecipientStatus = "active" | "disabled";

/** A disabled account may not receive new personalized derivatives. */
export function assertRecipientIsActive(status: RecipientStatus): void {
  if (status !== "active") throw new Error("RECIPIENT_NOT_ACTIVE");
}
