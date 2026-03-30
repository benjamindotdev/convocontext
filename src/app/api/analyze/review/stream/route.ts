import { sha256Hex , parseWhatsAppConversation } from "@/lib/utils";
import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runThemesLayer } from "@/lib/layers/themes";

import { createLogger } from "@/lib/logger";
import type { EventSummary, PersonSummary, ThemeSummary } from "@/lib/types";


type IdentityLink = {
  incomingName: string;
  existingName: string;
};

type ReviewStreamBody = {
  chats: {
    id: string; // the client-side ID
    conversationId: string; // DB ID
    title?: string;
    conversation: string;
  }[];
  reviewedPeople: PersonSummary[];
  identityLinks?: IdentityLink[];
};

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasLookup(people: PersonSummary[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const person of people) {
    const canonical = person.name.trim();
    if (!canonical) continue;
    for (const name of [canonical, ...person.aliases]) {
      const key = normalize(name);
      if (key && !lookup.has(key)) lookup.set(key, canonical);
    }
  }
  return lookup;
}

function canonicalizeText(value: string, lookup: Map<string, string>): string {
  let next = value;
  const aliases = Array.from(lookup.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonical] of aliases) {
    if (!alias || normalize(canonical) === alias) continue;
    next = next.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), canonical);
  }
  return next;
}

function canonicalizeEvents(events: EventSummary[], lookup: Map<string, string>): EventSummary[] {
  return events.map((event) => ({
    ...event,
    title: canonicalizeText(event.title, lookup),
    description: canonicalizeText(event.description, lookup),
    participants: Array.from(new Set(event.participants.map(p => canonicalizeText(p, lookup)))),
  }));
}

function canonicalizeThemes(themes: ThemeSummary[], lookup: Map<string, string>): ThemeSummary[] {
  return themes.map((theme) => ({
    ...theme,
    description: canonicalizeText(theme.description, lookup),
    eventTitles: Array.from(new Set(theme.eventTitles.map(t => canonicalizeText(t, lookup)))),
  }));
}

function toChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const logger = createLogger("api.analyze.review.stream", { requestId: crypto.randomUUID() });
  let body: ReviewStreamBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.chats || body.chats.length === 0) {
    return NextResponse.json({ error: "No chats provided." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(toChunk(event, data)));

      const run = async () => {
        const convex = getConvexAdminClient();
        const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
        const model = anthropic(modelName);

        emit("session_resumed", { resumedAt: Date.now() });

        // Phase 2 Transition Lock
        if (convex) {
          logger.info("committing_global_identities");
          await convex.mutation(convexFns.commitGlobalIdentities, {
            conversationIds: body.chats.map(c => c.conversationId),
            people: body.reviewedPeople,
            identityLinks: body.identityLinks || [],
          });
        }

        const personLookup = buildAliasLookup(body.reviewedPeople);

        // Phase 3 Loop
        for (const chat of body.chats) {
          const raw = String(chat.conversation ?? "").trim();
          const parsed = parseWhatsAppConversation(raw);
          if (parsed.length === 0) continue;

          let contextEvents: any[] = [];
          let contextThemes: any[] = [];
          if (convex) {
             const ctxData = await convex.query(convexFns.getGlobalContext, { eventLimit: 25, themeLimit: 25 });
             contextEvents = ctxData.events || [];
             contextThemes = ctxData.themes || [];
          }

          emit("layer_started", { chatId: chat.id, layer: "events" });
          const eventsRaw = await runEventsLayer(parsed, body.reviewedPeople, model, { existingEvents: contextEvents });
          const events = canonicalizeEvents(eventsRaw, personLookup);
          emit("layer_done", { chatId: chat.id, layer: "events", count: events.length });

          emit("layer_started", { chatId: chat.id, layer: "themes" });
          const themesRaw = await runThemesLayer(parsed, events, model, undefined, { existingThemes: contextThemes });
          const themes = canonicalizeThemes(themesRaw, personLookup);
          emit("layer_done", { chatId: chat.id, layer: "themes", count: themes.length });

          if (convex && chat.conversationId !== "NO_ID") {
            await convex.mutation(convexFns.savePhase3Analysis, {
              conversationId: chat.conversationId,
              events,
              themes
            });
          }
          
          emit("chat_done", { chatId: chat.id, title: chat.title || "Chat" });
        }

        emit("session_done", { completedAt: Date.now() });
        controller.close();
      };

      run().catch((err) => {
        logger.error("review_stream_error", { error: err.stack });
        emit("session_error", { error: err.message });
        controller.close();
      });
    }
  });

  return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}
