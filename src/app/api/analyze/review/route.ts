import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runThemesLayer } from "@/lib/layers/themes";
import { sha256Hex } from "@/lib/hash";
import { createLogger, errorMeta } from "@/lib/logger";
import type { PersonSummary } from "@/lib/types";
import { parseWhatsAppConversation } from "@/lib/whatsapp";

type IdentityLink = {
  incomingName: string;
  existingName: string;
};

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createLogger("api.analyze.review", { requestId });

  try {
    const body = await request.json();
    const chatId = String(body?.chatId ?? "").trim();
    const rawConversation = String(body?.conversation ?? "").trim();
    const providedTitle = String(body?.title ?? "").trim();
    const reviewedPeople = Array.isArray(body?.reviewedPeople)
      ? (body.reviewedPeople as PersonSummary[])
      : [];
    const identityLinks = Array.isArray(body?.identityLinks)
      ? (body.identityLinks as IdentityLink[])
      : [];

    logger.info("review_resume_received", {
      chatId,
      rawChars: rawConversation.length,
      reviewedPeopleCount: reviewedPeople.length,
      identityLinksCount: identityLinks.length,
    });

    if (!rawConversation) {
      return NextResponse.json({ error: "Conversation text is required." }, { status: 400 });
    }

    const parsed = parseWhatsAppConversation(rawConversation);
    if (parsed.length === 0) {
      return NextResponse.json(
        {
          error:
            "No WhatsApp messages could be parsed. Use exported lines like '12/24/2025, 9:00 PM - Name: message'.",
        },
        { status: 400 },
      );
    }

    const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    const model = anthropic(modelName);
    const title = providedTitle || suggestConversationTitle(parsed);
    const conversationHash = await sha256Hex(rawConversation);

    const events = await runEventsLayer(parsed, reviewedPeople, model);
    const themes = await runThemesLayer(parsed, events, model);

    const analysis = {
      messages: parsed,
      people: reviewedPeople,
      events,
      themes,
    };

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
            chatId,
            error: "This conversation has already been analyzed.",
            duplicate: true,
            conversationId: existing[0].conversationId,
            existingTitle: existing[0].title,
            title,
            conversationHash,
            analysis,
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
        identityLinks,
      });

      conversationId = persisted.conversationId;
      duplicate = persisted.duplicate;
    }

    logger.info("review_resume_complete", {
      chatId,
      title,
      conversationId,
      duplicate,
      eventsCount: events.length,
      themesCount: themes.length,
    });

    return NextResponse.json({
      chatId,
      title,
      conversationHash,
      conversationId,
      duplicate,
      persisted: Boolean(conversationId),
      analysis,
    });
  } catch (error) {
    logger.error("review_resume_failed", errorMeta(error));
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
