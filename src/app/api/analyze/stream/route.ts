import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runPeopleLayer } from "@/lib/layers/people";
import { runThemesLayer } from "@/lib/layers/themes";
import { sha256Hex } from "@/lib/hash";
import { createLogger, errorMeta } from "@/lib/logger";
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

function splitNameParts(value: string): { firstName: string; lastNames: string[] } {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastNames: parts.slice(1),
  };
}

function toChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createLogger("api.analyze.stream", { requestId });
  let chats: StreamChat[] = [];

  try {
    const body = await request.json();
    chats = Array.isArray(body?.chats) ? body.chats : [];
    logger.info("request_received", { chatCount: chats.length });
  } catch {
    logger.warn("invalid_json_body");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (chats.length === 0) {
    logger.warn("empty_chat_array");
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

        logger.info("session_started", {
          totalChats: chats.length,
          modelName,
          convexConfigured: Boolean(convex),
        });

        emit("session_started", {
          totalChats: chats.length,
          startedAt: Date.now(),
        });

        for (const [index, chat] of chats.entries()) {
          const chatLogger = logger.child({
            chatId: chat.id,
            chatIndex: index,
          });
          const rawConversation = String(chat.conversation ?? "").trim();
          const providedTitle = String(chat.title ?? "").trim();

          chatLogger.info("chat_received", {
            rawChars: rawConversation.length,
            titleProvided: providedTitle.length > 0,
          });

          if (!rawConversation) {
            chatLogger.warn("chat_empty_conversation");
            emit("chat_error", {
              chatId: chat.id,
              error: "Conversation text is required.",
            });
            continue;
          }

          const parsed = parseWhatsAppConversation(rawConversation);
          chatLogger.info("chat_parsed", { messageCount: parsed.length });

          if (parsed.length === 0) {
            chatLogger.warn("chat_parse_failed_zero_messages");
            emit("chat_error", {
              chatId: chat.id,
              error:
                "No WhatsApp messages could be parsed. Use exported lines like '12/24/2025, 9:00 PM - Name: message'.",
            });
            continue;
          }

          const title = providedTitle || suggestConversationTitle(parsed);
          const conversationHash = await sha256Hex(rawConversation);
          chatLogger.info("chat_prepared", { title });

          if (convex) {
            const existing = await convex.query(convexFns.checkConversationHashes, {
              hashes: [conversationHash],
            });

            if (existing.length > 0) {
              chatLogger.info("chat_duplicate_detected", {
                existingConversationId: existing[0].conversationId,
              });
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
            chatLogger.info("layer_started", { layer: "people" });

            const people = await runPeopleLayer(parsed, model);
            chatLogger.info("layer_complete", { layer: "people", count: people.length });

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

            const uniqueLinks = new Map<string, { incomingName: string; existingName: string }>();

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
                  activeConversationId: string[];
                  passiveConversationId: string[];
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
                      activeConversationId: match.activeConversationId || [],
                      passiveConversationId: match.passiveConversationId || [],
                    });
                  }
                }

                for (const conflict of collisions) {
                  const key = `${normalize(conflict.incomingName)}::${normalize(conflict.existingName)}`;
                  if (!uniqueLinks.has(key)) {
                    uniqueLinks.set(key, {
                      incomingName: conflict.incomingName,
                      existingName: conflict.existingName,
                    });
                  }
                }

              }
            }

            emit("people_review_prompt", {
              chatId: chat.id,
              title,
              reviewPeople: people.map((person) => {
                const parts = splitNameParts(person.name);
                return {
                  fullName: person.name,
                  firstName: parts.firstName,
                  lastNames: parts.lastNames,
                  aliases: person.aliases,
                  summary: person.summary,
                  messageCount: person.messageCount,
                };
              }),
              potentialLinks: Array.from(uniqueLinks.values()),
            });

            emit("chat_paused_review", {
              chatId: chat.id,
              title,
              conversationHash,
              messages: parsed,
              people,
              pendingReason: "awaiting_people_review",
            });

            emit("session_paused_review", {
              chatId: chat.id,
              title,
              pausedAt: Date.now(),
              pendingReason: "awaiting_people_review",
            });

            chatLogger.info("chat_paused_for_review", {
              peopleCount: people.length,
              potentialLinks: uniqueLinks.size,
            });

            controller.close();
            return;

            emit("layer_done", {
              chatId: chat.id,
              layer: "people",
              count: people.length,
            });

            emit("layer_started", {
              chatId: chat.id,
              layer: "events",
            });
            chatLogger.info("layer_started", { layer: "events" });

            const events = await runEventsLayer(parsed, people, model);
            chatLogger.info("layer_complete", { layer: "events", count: events.length });

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
            chatLogger.info("layer_started", { layer: "themes" });

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
            chatLogger.info("layer_complete", { layer: "themes", count: themes.length });

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
              chatLogger.info("persist_complete", {
                conversationId,
                duplicate,
              });
            } else {
              chatLogger.warn("convex_not_configured");
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
            chatLogger.error("chat_failed", {
              ...errorMeta(error),
            });
            emit("chat_error", {
              chatId: chat.id,
              error: error instanceof Error ? error.message : "Unexpected error",
            });
          }
        }

        emit("session_done", { completedAt: Date.now() });
        logger.info("session_done", { totalChats: chats.length });
        controller.close();
      };

      run().catch((error) => {
        logger.error("session_failed", {
          ...errorMeta(error),
        });
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
