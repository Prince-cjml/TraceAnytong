import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "../components/convex-client-provider";

export const metadata: Metadata = {
  title: "TraceAnytong — Forensic attribution",
  description: "Anonymous provenance and explainable forensic trace workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ConvexClientProvider>{children}</ConvexClientProvider></body></html>;
}
