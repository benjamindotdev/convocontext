import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const messageValidator = v.object({
  speaker: v.string(),
  text: v.string(),
  timestamp: v.optional(v.string()),
  line: v.number(),
});

const personValidator = v.object({
  name: v.string(),
  aliases: v.array(v.string()),
  summary: v.string(),
  messageCount: v.number(),
});

const eventValidator = v.object({
  title: v.string(),
  description: v.string(),
  participants: v.array(v.string()),
  timeframe: v.string(),
  evidenceLines: v.array(v.number()),
  topics: v.array(v.string()),
});

const themeValidator = v.object({
  name: v.string(),
  description: v.string(),
  keywords: v.array(v.string()),
  eventTitles: v.array(v.string()),
  confidence: v.number(),
});

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

const EVENT_LINK_STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "from",
  "this",
  "your",
  "have",
  "been",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "would",
  "could",
  "should",
  "about",
  "there",
  "their",
  "them",
  "they",
  "just",
  "very",
  "more",
  "some",
]);

function eventSignalTokens(event: {
  title: string;
  description: string;
  topics: string[];
}): string[] {
  const raw = `${event.title} ${event.description} ${event.topics.join(" ")}`.toLowerCase();
  const words = raw
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !EVENT_LINK_STOP_WORDS.has(word));

  return Array.from(new Set(words));
}

export const saveConversationAnalysis = mutation({
  args: {
    title: v.string(),
    rawText: v.string(),
    conversationHash: v.string(),
    messages: v.array(messageValidator),
    people: v.array(personValidator),
    events: v.array(eventValidator),
    themes: v.array(themeValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_conversation_hash", (q) =>
        q.eq("conversationHash", args.conversationHash),
      )
      .unique();

    if (existing) {
      return {
        conversationId: existing._id,
        duplicate: true,
      };
    }

    const now = Date.now();

    const conversationId = await ctx.db.insert("conversations", {
      title: args.title,
      rawText: args.rawText,
      conversationHash: args.conversationHash,
      createdAt: now,
      analyzedAt: now,
    });

    const messageIdsByLine = new Map<number, Id<"messages">>();

    for (const message of args.messages) {
      const messageId = await ctx.db.insert("messages", {
        conversationId,
        line: message.line,
        speaker: message.speaker,
        text: message.text,
        timestamp: message.timestamp,
        createdAt: now,
      });

      if (!messageIdsByLine.has(message.line)) {
        messageIdsByLine.set(message.line, messageId);
      }
    }

    const personIdsByName = new Map<string, Id<"people">>();

    for (const person of args.people) {
      const personId = await ctx.db.insert("people", {
        conversationId,
        name: person.name,
        nameNormalized: normalize(person.name),
        aliases: person.aliases,
        summary: person.summary,
        messageCount: person.messageCount,
        createdAt: now,
      });

      personIdsByName.set(normalize(person.name), personId);
    }

    const eventIdsByTitle = new Map<string, Id<"events">>();
    const eventMessageIds = new Map<string, Set<Id<"messages">>>();

    for (const event of args.events) {
      const eventKey = normalize(event.title);
      const eventId = await ctx.db.insert("events", {
        conversationId,
        title: event.title,
        titleNormalized: eventKey,
        description: event.description,
        participants: event.participants,
        timeframe: event.timeframe,
        evidenceLines: event.evidenceLines,
        topics: event.topics,
        createdAt: now,
      });

      eventIdsByTitle.set(eventKey, eventId);

      const linkedMessageIds = new Set<Id<"messages">>();
      for (const line of event.evidenceLines) {
        const messageId = messageIdsByLine.get(line);
        if (messageId) linkedMessageIds.add(messageId);
      }

      if (linkedMessageIds.size === 0) {
        const signalTokens = eventSignalTokens(event);

        for (const message of args.messages) {
          const messageId = messageIdsByLine.get(message.line);
          if (!messageId) continue;

          const text = message.text.toLowerCase();
          const matchesSignal = signalTokens.some((token) => text.includes(token));

          if (matchesSignal) {
            linkedMessageIds.add(messageId);
          }
        }
      }

      eventMessageIds.set(eventKey, linkedMessageIds);
    }

    const themeIdsByName = new Map<string, Id<"themes">>();

    for (const theme of args.themes) {
      const themeKey = normalize(theme.name);
      const themeId = await ctx.db.insert("themes", {
        conversationId,
        name: theme.name,
        nameNormalized: themeKey,
        description: theme.description,
        keywords: theme.keywords,
        eventTitles: theme.eventTitles,
        confidence: theme.confidence,
        createdAt: now,
      });

      themeIdsByName.set(themeKey, themeId);
    }

    const personLinkSet = new Set<string>();

    for (const person of args.people) {
      const personId = personIdsByName.get(normalize(person.name));
      if (!personId) continue;

      const tokens = [person.name, ...person.aliases]
        .map(normalize)
        .filter((token) => token.length > 1);

      for (const message of args.messages) {
        const messageId = messageIdsByLine.get(message.line);
        if (!messageId) continue;

        const speaker = normalize(message.speaker);
        const text = message.text.toLowerCase();
        const speakerMatch = tokens.includes(speaker);
        const textMatch = tokens.some((token) => token.length > 2 && text.includes(token));

        if (!speakerMatch && !textMatch) {
          continue;
        }

        const key = `${messageId}:${personId}`;
        if (personLinkSet.has(key)) continue;
        personLinkSet.add(key);

        await ctx.db.insert("messagePeople", {
          conversationId,
          messageId,
          personId,
          createdAt: now,
        });
      }
    }

    const eventLinkSet = new Set<string>();

    for (const [eventKey, messageIds] of eventMessageIds.entries()) {
      const eventId = eventIdsByTitle.get(eventKey);
      if (!eventId) continue;

      for (const messageId of messageIds) {
        const key = `${messageId}:${eventId}`;
        if (eventLinkSet.has(key)) continue;
        eventLinkSet.add(key);

        await ctx.db.insert("messageEvents", {
          conversationId,
          messageId,
          eventId,
          createdAt: now,
        });
      }
    }

    const themeLinkSet = new Set<string>();

    for (const theme of args.themes) {
      const themeId = themeIdsByName.get(normalize(theme.name));
      if (!themeId) continue;

      const linkedMessageIds = new Set<Id<"messages">>();

      for (const eventTitle of theme.eventTitles) {
        const eventMessages = eventMessageIds.get(normalize(eventTitle));
        if (!eventMessages) continue;
        for (const messageId of eventMessages) {
          linkedMessageIds.add(messageId);
        }
      }

      if (linkedMessageIds.size === 0) {
        const keywordTokens = theme.keywords
          .map(normalize)
          .filter((keyword) => keyword.length > 2);

        for (const message of args.messages) {
          const messageId = messageIdsByLine.get(message.line);
          if (!messageId) continue;

          if (keywordTokens.some((token) => message.text.toLowerCase().includes(token))) {
            linkedMessageIds.add(messageId);
          }
        }
      }

      for (const messageId of linkedMessageIds) {
        const key = `${messageId}:${themeId}`;
        if (themeLinkSet.has(key)) continue;
        themeLinkSet.add(key);

        await ctx.db.insert("messageThemes", {
          conversationId,
          messageId,
          themeId,
          createdAt: now,
        });
      }
    }

    return {
      conversationId,
      duplicate: false,
    };
  },
});

export const checkConversationHashes = query({
  args: { hashes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const found: Array<{ hash: string; conversationId: string; title: string }> = [];

    for (const hash of args.hashes) {
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_conversation_hash", (q) => q.eq("conversationHash", hash))
        .unique();

      if (conversation) {
        found.push({
          hash,
          conversationId: conversation._id,
          title: conversation.title,
        });
      }
    }

    return found;
  },
});

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("conversations")
      .order("desc")
      .take(50);
  },
});

export const getConversationWithAnalysis = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_and_line", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(5000);

    const people = await ctx.db
      .query("people")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(500);

    const events = await ctx.db
      .query("events")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(500);

    const themes = await ctx.db
      .query("themes")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(500);

    return {
      conversation,
      analysis: {
        messages: messages.map((message) => ({
          speaker: message.speaker,
          text: message.text,
          timestamp: message.timestamp,
          line: message.line,
        })),
        people: people.map((person) => ({
          name: person.name,
          aliases: person.aliases,
          summary: person.summary,
          messageCount: person.messageCount,
        })),
        events: events.map((event) => ({
          title: event.title,
          description: event.description,
          participants: event.participants,
          timeframe: event.timeframe,
          evidenceLines: event.evidenceLines,
          topics: event.topics,
        })),
        themes: themes.map((theme) => ({
          name: theme.name,
          description: theme.description,
          keywords: theme.keywords,
          eventTitles: theme.eventTitles,
          confidence: theme.confidence,
        })),
      },
    };
  },
});
