import { sha256Hex , parseWhatsAppConversation } from "@/lib/utils";
import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runEventsLayer } from "@/lib/layers/events";
import { runThemesLayer } from "@/lib/layers/themes";

import { createLogger, errorMeta } from "@/lib/logger";
import type { PersonSummary } from "@/lib/types";


type IdentityLink = {
  incomingName: string;
  existingName: string;
};

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function consolidatePeople(people: PersonSummary[]): PersonSummary[] {
  const byName = new Map<string, PersonSummary>();

  for (const person of people) {
    const key = normalize(person.name);
    if (!key) continue;
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        ...person,
        aliases: Array.from(new Set(person.aliases.map((alias) => alias.trim()).filter(Boolean))),
      });
      continue;
    }

    byName.set(key, {
      ...existing,
      aliases: Array.from(
        new Set([...existing.aliases, ...person.aliases].map((alias) => alias.trim()).filter(Boolean)),
      ),
      summary: existing.summary.includes(person.summary)
        ? existing.summary
        : `${existing.summary}\n\n${person.summary}`.trim(),
      messageCount: existing.messageCount + person.messageCount,
    });
  }

  return Array.from(byName.values());
}

function buildAliasLookup(people: PersonSummary[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const person of people) {
    const canonical = person.name.trim();
    if (!canonical) continue;

    for (const label of [canonical, ...person.aliases]) {
      const key = normalize(label);
      if (!key) continue;
      if (!lookup.has(key)) {
        lookup.set(key, canonical);
      }
    }
  }

  return lookup;
}

function canonicalizeText(value: string, lookup: Map<string, string>): string {
  let next = value;
  const aliases = Array.from(lookup.entries())
    .sort((a, b) => b[0].length - a[0].length)
    .map(([alias, canonical]) => ({ alias, canonical }));

  for (const { alias, canonical } of aliases) {
    if (!alias || normalize(canonical) === alias) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
    next = next.replace(pattern, canonical);
  }

  return next;
}

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

    const convex = getConvexAdminClient();
    let existingEvents: Array<{
      title: string;
      description: string;
      participants: string[];
      topics: string[];
    }> = [];
    let existingThemes: Array<{
      name: string;
      description: string;
      keywords: string[];
      eventTitles: string[];
    }> = [];

    if (convex) {
      const globalContext = await convex.query(convexFns.getGlobalContext, {
        eventLimit: 25,
        themeLimit: 25,
      });
      existingEvents = globalContext.events || [];
      existingThemes = globalContext.themes || [];
    }

    const consolidatedPeople = consolidatePeople(reviewedPeople);
    const aliasLookup = buildAliasLookup(consolidatedPeople);

    const events = (await runEventsLayer(parsed, consolidatedPeople, model, {
      existingEvents,
    })).map((event) => ({
      ...event,
      participants: Array.from(
        new Set(
          event.participants.map((participant) => {
            const canonical = aliasLookup.get(normalize(participant));
            return canonical || participant;
          }),
        ),
      ),
      title: canonicalizeText(event.title, aliasLookup),
      description: canonicalizeText(event.description, aliasLookup),
    }));
    const themes = (await runThemesLayer(parsed, events, model, undefined, {
      existingThemes,
    })).map((theme) => ({
      ...theme,
      description: canonicalizeText(theme.description, aliasLookup),
      keywords: Array.from(new Set(theme.keywords.map((keyword) => canonicalizeText(keyword, aliasLookup)))),
    }));

    const analysis = {
      messages: parsed,
      people: consolidatedPeople,
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
