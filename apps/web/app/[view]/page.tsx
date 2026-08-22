import { notFound } from "next/navigation";
import { Workspace, type View } from "../../components/workspace";

const views: View[] = ["documents", "trace", "benchmarks", "workers", "settings"];

export default async function ViewPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<{ caseId?: string }> }) {
  const [{ view }, { caseId }] = await Promise.all([params, searchParams]);
  if (!views.includes(view as View)) notFound();
  return <Workspace initialView={view as View} traceCaseId={caseId} />;
}
