import { signOut } from "@workos-inc/authkit-nextjs";

/** Ends the current AuthKit session and redirects only to the local app root. */
export async function GET() {
  await signOut({ returnTo: "/" });
}
