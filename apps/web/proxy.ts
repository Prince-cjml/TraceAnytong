import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { isWorkOSAuthBridgeEnabled } from "./lib/workos-auth-config";

/**
 * Next.js 16 calls this proxy before application routes. Its no-auth branch is
 * intentionally a pass-through so local/demo deployments never manufacture an
 * AuthKit session or make privileged Convex calls.
 */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isWorkOSAuthBridgeEnabled()) return NextResponse.next();
  return authkitProxy()(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
