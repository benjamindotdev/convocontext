import { sha256Hex , parseWhatsAppConversation } from "@/lib/utils";
import { NextResponse } from "next/server";

import { analyzeConversation, suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";

import { createLogger, errorMeta } from "@/lib/logger";


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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createLogger("api.analyze.route", { requestId });

  try {
    const body = await request.json();
    const rawConversation = String(body?.conversation ?? "").trim();
    const providedTitle = String(body?.title ?? "").trim();

    logger.info("request_received", {
      rawChars: rawConversation.length,
      titleProvided: providedTitle.length > 0,
    });

    if (!rawConversation) {
      logger.warn("empty_conversation");
      return NextResponse.json(
        { error: "Conversation text is required." },
        { status: 400 },
      );
    }

    const messages = parseWhatsAppConversation(rawConversation);
    logger.info("conversation_parsed", { messageCount: messages.length });

    if (messages.length === 0) {
      logger.warn("parse_failed_zero_messages");
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
    logger.info("analysis_complete", {
      title,
      peopleCount: analysis.people.length,
      eventsCount: analysis.events.length,
      themesCount: analysis.themes.length,
    });

    let conversationId: string | null = null;
    let duplicate = false;
    const peopleFirstNameConflicts: Array<{
      firstName: string;
      incomingName: string;
      incomingLastNames: string[];
      existingName: string;
      existingLastNames: string[];
      activeConversationId: string[];
      passiveConversationId: string[];
    }> = [];

    const convex = getConvexAdminClient();

    if (convex) {
      logger.info("convex_available");
      const existing = await convex.query(convexFns.checkConversationHashes, {
        hashes: [conversationHash],
      });

      if (existing.length > 0) {
        logger.info("duplicate_detected", {
          existingConversationId: existing[0].conversationId,
        });
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

      const firstNames = Array.from(
        new Set(
          analysis.people
            .map((person) => firstNameFromFullName(person.name))
            .map((name) => normalize(name))
            .filter((name) => name.length > 0),
        ),
      );

      if (firstNames.length > 0) {
        const matches = await convex.query(convexFns.findPeopleByFirstNames, {
          firstNames,
        });

        for (const person of analysis.people) {
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

            peopleFirstNameConflicts.push({
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
      logger.info("persist_complete", {
        conversationId,
        duplicate,
      });
    } else {
      logger.warn("convex_not_configured");
    }

    logger.info("request_complete", {
      persisted: Boolean(conversationId),
      peopleFirstNameConflicts: peopleFirstNameConflicts.length,
    });

    return NextResponse.json({
      title,
      conversationId,
      duplicate,
      conversationHash,
      persisted: Boolean(conversationId),
      peopleFirstNameConflicts,
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("request_failed", {
      ...errorMeta(error),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
