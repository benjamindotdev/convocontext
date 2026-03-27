import { NextResponse } from "next/server";

import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { createLogger, errorMeta } from "@/lib/logger";

export async function POST(request: Request) {
  const logger = createLogger("api.conversations.check", {
    requestId: crypto.randomUUID(),
  });
  try {
    const body = await request.json();
    const hashes = Array.isArray(body?.hashes)
      ? body.hashes
          .map((hash: unknown) => String(hash ?? "").trim())
          .filter((hash: string) => hash.length > 0)
      : [];

    logger.info("hash_check_received", { hashCount: hashes.length });

    if (hashes.length === 0) {
      return NextResponse.json({ existing: [] });
    }

    const convex = getConvexAdminClient();

    if (!convex) {
      logger.warn("convex_not_configured");
      return NextResponse.json({ existing: [] });
    }

    const existing = await convex.query(convexFns.checkConversationHashes, {
      hashes,
    });

    logger.info("hash_check_complete", {
      hashCount: hashes.length,
      existingCount: existing.length,
    });

    return NextResponse.json({ existing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("hash_check_failed", errorMeta(error));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
