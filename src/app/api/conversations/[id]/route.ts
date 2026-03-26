import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const convex = getConvexAdminClient();

  if (!convex) {
    return NextResponse.json(
      { error: "Convex is not configured in environment variables." },
      { status: 500 },
    );
  }

  try {
    const { id } = await context.params;

    const item = await convex.query(convexFns.getConversationWithAnalysis, {
      conversationId: id,
    });

    if (!item) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
