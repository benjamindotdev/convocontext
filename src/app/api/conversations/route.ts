import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";

export async function GET() {
  const convex = getConvexAdminClient();

  if (!convex) {
    return NextResponse.json({ conversations: [] });
  }

  try {
    const conversations = await convex.query(convexFns.listConversations, {});

    return NextResponse.json({ conversations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
