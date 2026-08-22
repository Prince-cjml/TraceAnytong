import { ProtectedContent } from "../../../components/protected-content";

export default async function ProtectedRoute({ params }: { params: Promise<{ route: string[] }> }) {
  const { route } = await params;
  return <ProtectedContent routeScope={`/protected/${route.join("/")}`} />;
}
