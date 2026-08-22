import { handleAuth } from "@workos-inc/authkit-nextjs";

/** WorkOS redirects here after a successful hosted AuthKit interaction. */
export const GET = handleAuth();
