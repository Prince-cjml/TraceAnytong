import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceAnytong — Forensic attribution",
  description: "Anonymous provenance and explainable forensic trace workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
