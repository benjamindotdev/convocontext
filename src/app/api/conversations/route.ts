import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { createLogger, errorMeta } from "@/lib/logger";

export async function GET() {
  const logger = createLogger("api.conversations.list", {
    requestId: crypto.randomUUID(),
  });
  const convex = getConvexAdminClient();

  if (!convex) {
    logger.warn("convex_not_configured");
    return NextResponse.json({ conversations: [] });
  }

  try {
    const conversations = await convex.query(convexFns.listConversations, {});
    logger.info("list_success", { count: conversations.length });

    return NextResponse.json({ conversations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("list_failed", errorMeta(error));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
