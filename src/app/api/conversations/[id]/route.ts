import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { createLogger, errorMeta } from "@/lib/logger";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const logger = createLogger("api.conversations.detail", {
    requestId: crypto.randomUUID(),
  });
  const convex = getConvexAdminClient();

  if (!convex) {
    logger.warn("convex_not_configured");
    return NextResponse.json(
      { error: "Convex is not configured in environment variables." },
      { status: 500 },
    );
  }

  try {
    const { id } = await context.params;
    logger.info("detail_request", { conversationId: id });

    const item = await convex.query(convexFns.getConversationWithAnalysis, {
      conversationId: id,
    });

    if (!item) {
      logger.warn("detail_not_found", { conversationId: id });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    logger.info("detail_success", { conversationId: id });

    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("detail_failed", errorMeta(error));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
