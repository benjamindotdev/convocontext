import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runThemesLayer } from "@/lib/layers/themes";
import { sha256Hex } from "@/lib/hash";
import { createLogger, errorMeta } from "@/lib/logger";
import type { EventSummary, PersonSummary, ThemeSummary } from "@/lib/types";
import { parseWhatsAppConversation } from "@/lib/whatsapp";

type IdentityLink = {
  incomingName: string;
  existingName: string;
};

type ReviewStreamBody = {
  chatId: string;
  title?: string;
  conversation: string;
  reviewedPeople: PersonSummary[];
  identityLinks?: IdentityLink[];
};

function toChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createLogger("api.analyze.review.stream", { requestId });

  let body: ReviewStreamBody;

  try {
    const parsed = await request.json();
    body = {
      chatId: String(parsed?.chatId ?? "").trim(),
      title: String(parsed?.title ?? "").trim(),
      conversation: String(parsed?.conversation ?? "").trim(),
      reviewedPeople: Array.isArray(parsed?.reviewedPeople)
        ? (parsed.reviewedPeople as PersonSummary[])
        : [],
      identityLinks: Array.isArray(parsed?.identityLinks)
        ? (parsed.identityLinks as IdentityLink[])
        : [],
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.conversation) {
    return NextResponse.json({ error: "Conversation text is required." }, { status: 400 });
  }

  const parsedMessages = parseWhatsAppConversation(body.conversation);
  if (parsedMessages.length === 0) {
    return NextResponse.json(
      {
        error:
          "No WhatsApp messages could be parsed. Use exported lines like '12/24/2025, 9:00 PM - Name: message'.",
      },
      { status: 400 },
    );
  }

  const convex = getConvexAdminClient();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(toChunk(event, data)));
      };

      const run = async () => {
        try {
          const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
          const model = anthropic(modelName);
          const title = body.title || suggestConversationTitle(parsedMessages);
          const conversationHash = await sha256Hex(body.conversation);

          logger.info("review_stream_started", {
            chatId: body.chatId,
            title,
            reviewedPeopleCount: body.reviewedPeople.length,
          });

          emit("session_started", {
            totalChats: 1,
            startedAt: Date.now(),
            resumedFromReview: true,
          });

          emit("chat_started", {
            chatId: body.chatId,
            title,
            messages: parsedMessages,
          });

          emit("people_delta", {
            chatId: body.chatId,
            people: body.reviewedPeople,
          });

          emit("layer_done", {
            chatId: body.chatId,
            layer: "people",
            count: body.reviewedPeople.length,
          });

          emit("layer_started", {
            chatId: body.chatId,
            layer: "events",
          });

          const events = await runEventsLayer(parsedMessages, body.reviewedPeople, model);

          const eventsAcc: EventSummary[] = [];
          for (const event of events) {
            eventsAcc.push(event);
            emit("events_delta", {
              chatId: body.chatId,
              events: [...eventsAcc],
            });
          }

          emit("layer_done", {
            chatId: body.chatId,
            layer: "events",
            count: events.length,
          });

          emit("layer_started", {
            chatId: body.chatId,
            layer: "themes",
          });

          let latestThemes: ThemeSummary[] = [];
          const themes = await runThemesLayer(parsedMessages, events, model, (progressThemes) => {
            latestThemes = [...progressThemes];
            emit("themes_delta", {
              chatId: body.chatId,
              themes: latestThemes,
            });
          });

          if (latestThemes.length === 0 && themes.length > 0) {
            emit("themes_delta", {
              chatId: body.chatId,
              themes,
            });
          }

          emit("layer_done", {
            chatId: body.chatId,
            layer: "themes",
            count: themes.length,
          });

          const analysis = {
            messages: parsedMessages,
            people: body.reviewedPeople,
            events,
            themes,
          };

          let conversationId: string | null = null;
          let duplicate = false;

          if (convex) {
            const existing = await convex.query(convexFns.checkConversationHashes, {
              hashes: [conversationHash],
            });

            if (existing.length > 0) {
              emit("chat_duplicate", {
                chatId: body.chatId,
                title,
                conversationHash,
                conversationId: existing[0].conversationId,
                existingTitle: existing[0].title,
                error: "This conversation has already been analyzed.",
              });

              emit("session_done", { completedAt: Date.now(), resumedFromReview: true });
              controller.close();
              return;
            }

            const persisted = await convex.mutation(convexFns.saveConversationAnalysis, {
              title,
              rawText: body.conversation,
              conversationHash,
              messages: analysis.messages,
              people: analysis.people,
              events: analysis.events,
              themes: analysis.themes,
              identityLinks: body.identityLinks,
            });

            conversationId = persisted.conversationId;
            duplicate = persisted.duplicate;
          }

          emit("chat_done", {
            chatId: body.chatId,
            title,
            conversationHash,
            conversationId,
            duplicate,
            persisted: Boolean(conversationId),
            analysis,
          });

          emit("session_done", { completedAt: Date.now(), resumedFromReview: true });
          logger.info("review_stream_done", { chatId: body.chatId, conversationId });
          controller.close();
        } catch (error) {
          logger.error("review_stream_failed", errorMeta(error));
          emit("chat_error", {
            chatId: body.chatId,
            error: error instanceof Error ? error.message : "Unexpected error",
          });
          emit("session_error", {
            error: error instanceof Error ? error.message : "Unexpected error",
          });
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}