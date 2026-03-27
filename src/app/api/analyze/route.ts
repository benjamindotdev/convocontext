import { NextResponse } from "next/server";

import { analyzeConversation, suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { sha256Hex } from "@/lib/hash";
import { parseWhatsAppConversation } from "@/lib/whatsapp";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawConversation = String(body?.conversation ?? "").trim();
    const providedTitle = String(body?.title ?? "").trim();

    if (!rawConversation) {
      return NextResponse.json(
        { error: "Conversation text is required." },
        { status: 400 },
      );
    }

    const messages = parseWhatsAppConversation(rawConversation);

    if (messages.length === 0) {
      return NextResponse.json(
        {
          error:
            "No WhatsApp messages could be parsed. Use exported lines like '12/24/2025, 9:00 PM - Name: message'.",
        },
        { status: 400 },
      );
    }

    const analysis = await analyzeConversation(messages);
    const title = providedTitle || suggestConversationTitle(messages);
    const conversationHash = await sha256Hex(rawConversation);

    let conversationId: string | null = null;
    let duplicate = false;

    const convex = getConvexAdminClient();

    if (convex) {
      const existing = await convex.query(convexFns.checkConversationHashes, {
        hashes: [conversationHash],
      });

      if (existing.length > 0) {
        return NextResponse.json(
          {
            error: "This conversation has already been analyzed.",
            duplicate: true,
            conversationId: existing[0].conversationId,
            existingTitle: existing[0].title,
          },
          { status: 409 },
        );
      }

      const persisted = await convex.mutation(convexFns.saveConversationAnalysis, {
        title,
        rawText: rawConversation,
        conversationHash,
        messages: analysis.messages,
        people: analysis.people,
        events: analysis.events,
        themes: analysis.themes,
      });

      conversationId = persisted.conversationId;
      duplicate = persisted.duplicate;
    }

    return NextResponse.json({
      title,
      conversationId,
      duplicate,
      conversationHash,
      persisted: Boolean(conversationId),
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
