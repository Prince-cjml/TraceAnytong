import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/** Starts a hosted AuthKit sign-in; session validation remains server-side. */
export async function GET() {
  redirect(await getSignInUrl());
}
