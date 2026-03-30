import { AnalyzerDashboard } from "@/components/AnalyzerDashboard";
import { getConvexAdminClient, convexFns } from "@/lib/convex";
import { LibraryConversation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const convex = getConvexAdminClient();
  let initialLibraryConversations: LibraryConversation[] = [];

  if (convex) {
    try {
      initialLibraryConversations = await convex.query(convexFns.listConversations, {});
    } catch (e) {
      console.error("Failed to fetch library conversations on server:", e);
    }
  }

  return (
    <main>
      <AnalyzerDashboard initialLibraryConversations={initialLibraryConversations} />
    </main>
  );
}
