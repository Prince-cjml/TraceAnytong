import { notFound } from "next/navigation";
import { Workspace, type View } from "../../components/workspace";

const views: View[] = ["documents", "trace", "benchmarks", "workers", "settings"];

export default function ViewPage({ params }: { params: { view: string } }) {
  if (!views.includes(params.view as View)) notFound();
  return <Workspace initialView={params.view as View} />;
}
