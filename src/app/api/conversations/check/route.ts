import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const hashes = Array.isArray(body?.hashes)
      ? body.hashes
          .map((hash: unknown) => String(hash ?? "").trim())
          .filter((hash: string) => hash.length > 0)
      : [];

    if (hashes.length === 0) {
      return NextResponse.json({ existing: [] });
    }

    const convex = getConvexAdminClient();

    if (!convex) {
      return NextResponse.json({ existing: [] });
    }

    const existing = await convex.query(convexFns.checkConversationHashes, {
      hashes,
    });

    return NextResponse.json({ existing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
