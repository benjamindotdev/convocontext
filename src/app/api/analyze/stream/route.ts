import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runPeopleLayer } from "@/lib/layers/people";
import { runThemesLayer } from "@/lib/layers/themes";
import { sha256Hex } from "@/lib/hash";
import type {
  EventSummary,
  PersonSummary,
  ThemeSummary,
} from "@/lib/types";
import { parseWhatsAppConversation } from "@/lib/whatsapp";

type StreamChat = {
  id: string;
  title?: string;
  conversation: string;
};

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function firstNameFromFullName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || "";
}

function lastNamesFromFullName(value: string): string[] {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(1);
}

function toChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let chats: StreamChat[] = [];

  try {
    const body = await request.json();
    chats = Array.isArray(body?.chats) ? body.chats : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (chats.length === 0) {
    return NextResponse.json({ error: "At least one chat is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(toChunk(event, data)));
      };

      const run = async () => {
        const convex = getConvexAdminClient();
        const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
        const model = anthropic(modelName);

        emit("session_started", {
          totalChats: chats.length,
          startedAt: Date.now(),
        });

        for (const [index, chat] of chats.entries()) {
          const rawConversation = String(chat.conversation ?? "").trim();
          const providedTitle = String(chat.title ?? "").trim();

          if (!rawConversation) {
            emit("chat_error", {
              chatId: chat.id,
              error: "Conversation text is required.",
            });
            continue;
          }

          const parsed = parseWhatsAppConversation(rawConversation);

          if (parsed.length === 0) {
            emit("chat_error", {
              chatId: chat.id,
              error:
                "No WhatsApp messages could be parsed. Use exported lines like '12/24/2025, 9:00 PM - Name: message'.",
            });
            continue;
          }

          const title = providedTitle || suggestConversationTitle(parsed);
          const conversationHash = await sha256Hex(rawConversation);

          if (convex) {
            const existing = await convex.query(convexFns.checkConversationHashes, {
              hashes: [conversationHash],
            });

            if (existing.length > 0) {
              emit("chat_duplicate", {
                chatId: chat.id,
                title,
                conversationHash,
                conversationId: existing[0].conversationId,
                existingTitle: existing[0].title,
                error: "This conversation has already been analyzed.",
              });
              continue;
            }
          }

          emit("chat_started", {
            chatId: chat.id,
            chatIndex: index,
            title,
            fileName: providedTitle || title,
            conversationHash,
            messages: parsed,
          });

          try {
            emit("layer_started", {
              chatId: chat.id,
              layer: "people",
            });

            const people = await runPeopleLayer(parsed, model);

            // Stream people incrementally.
            const peopleAcc: PersonSummary[] = [];
            for (const person of people) {
              peopleAcc.push(person);
              emit("people_delta", {
                chatId: chat.id,
                people: peopleAcc,
                latest: person,
              });
            }

            if (convex) {
              const firstNames = Array.from(
                new Set(
                  people
                    .map((person) => firstNameFromFullName(person.name))
                    .map((name) => normalize(name))
                    .filter((name) => name.length > 0),
                ),
              );

              if (firstNames.length > 0) {
                const matches = await convex.query(convexFns.findPeopleByFirstNames, {
                  firstNames,
                });

                const collisions: Array<{
                  firstName: string;
                  incomingName: string;
                  incomingLastNames: string[];
                  existingName: string;
                  existingLastNames: string[];
                  conversationId: string;
                }> = [];

                for (const person of people) {
                  const personFirst = normalize(firstNameFromFullName(person.name));
                  if (!personFirst) continue;

                  const incomingLastNames = Array.from(
                    new Set(
                      [
                        ...lastNamesFromFullName(person.name),
                        ...person.aliases.flatMap((alias) => lastNamesFromFullName(alias)),
                      ]
                        .map((lastName) => normalize(lastName))
                        .filter((lastName) => lastName.length > 0),
                    ),
                  );

                  for (const match of matches) {
                    if (match.firstName !== personFirst) continue;

                    const samePersonName = normalize(match.personName) === normalize(person.name);
                    const existingLastNames = (match.lastNames || [])
                      .map((lastName: string) => normalize(lastName))
                      .filter((lastName: string) => lastName.length > 0);

                    const sharesLastName = existingLastNames.some((lastName: string) =>
                      incomingLastNames.includes(lastName),
                    );

                    if (samePersonName || sharesLastName) {
                      continue;
                    }

                    collisions.push({
                      firstName: personFirst,
                      incomingName: person.name,
                      incomingLastNames,
                      existingName: match.personName,
                      existingLastNames,
                      conversationId: match.conversationId,
                    });
                  }
                }

                if (collisions.length > 0) {
                  emit("people_first_name_conflicts", {
                    chatId: chat.id,
                    title,
                    conflicts: collisions,
                  });
                }
              }
            }

            emit("layer_done", {
              chatId: chat.id,
              layer: "people",
              count: people.length,
            });

            emit("layer_started", {
              chatId: chat.id,
              layer: "events",
            });

            const events = await runEventsLayer(parsed, people, model);

            // Stream events incrementally.
            const eventsAcc: EventSummary[] = [];
            for (const event of events) {
              eventsAcc.push(event);
              emit("events_delta", {
                chatId: chat.id,
                events: eventsAcc,
                latest: event,
              });
            }

            emit("layer_done", {
              chatId: chat.id,
              layer: "events",
              count: events.length,
            });

            emit("layer_started", {
              chatId: chat.id,
              layer: "themes",
            });

            let latestThemes: ThemeSummary[] = [];
            const themes = await runThemesLayer(parsed, events, model, (progressThemes) => {
              latestThemes = progressThemes;
              emit("themes_delta", {
                chatId: chat.id,
                themes: latestThemes,
                latest: latestThemes[latestThemes.length - 1] ?? null,
              });
            });

            // Fallback emit in case no per-topic updates were produced.
            if (latestThemes.length === 0) {
              emit("themes_delta", {
                chatId: chat.id,
                themes,
                latest: themes[themes.length - 1] ?? null,
              });
            }

            emit("layer_done", {
              chatId: chat.id,
              layer: "themes",
              count: themes.length,
            });

            const analysis = {
              messages: parsed,
              people,
              events,
              themes,
            };

            let conversationId: string | null = null;
            let duplicate = false;
            if (convex) {
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

            emit("chat_done", {
              chatId: chat.id,
              title,
              conversationHash,
              duplicate,
              conversationId,
              persisted: Boolean(conversationId),
              analysis,
            });
          } catch (error) {
            emit("chat_error", {
              chatId: chat.id,
              error: error instanceof Error ? error.message : "Unexpected error",
            });
          }
        }

        emit("session_done", { completedAt: Date.now() });
        controller.close();
      };

      run().catch((error) => {
        emit("session_error", {
          error: error instanceof Error ? error.message : "Unexpected error",
        });
        controller.close();
      });
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
