import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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

const identityLinkValidator = v.object({
  incomingName: v.string(),
  existingName: v.string(),
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

function extractNameParts(fullName: string): { firstName: string; lastNames: string[] } {
  const tokens = fullName
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { firstName: fullName.trim(), lastNames: [] };
  }

  return {
    firstName: tokens[0],
    lastNames: tokens.slice(1),
  };
}

function makePersonKey(firstName: string, lastNames: string[]): string {
  const first = normalize(firstName);
  const lasts = lastNames
    .map((lastName) => normalize(lastName))
    .filter((lastName) => lastName.length > 0)
    .sort((a, b) => a.localeCompare(b));

  return `${first}|${lasts.join("|")}`;
}

function displayName(firstName: string, lastNames: string[]): string {
  return [firstName, ...lastNames].filter(Boolean).join(" ").trim();
}

function logConvex(level: "info" | "warn" | "error", message: string, meta: Record<string, unknown> = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope: "convex.conversations",
    message,
    ...meta,
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}

function mergeSummary(existing: string, incoming: string): string {
  const left = existing.trim();
  const right = incoming.trim();

  if (!left) return right;
  if (!right) return left;
  if (left.includes(right)) return left;
  if (right.includes(left)) return right;

  return `${left}\n\n${right}`;
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
    identityLinks: v.optional(v.array(identityLinkValidator)),
  },
  handler: async (ctx, args) => {
    logConvex("info", "save_start", {
      title: args.title,
      rawChars: args.rawText.length,
      messageCount: args.messages.length,
      peopleCount: args.people.length,
      identityLinksCount: args.identityLinks?.length || 0,
      eventsCount: args.events.length,
      themesCount: args.themes.length,
    });

    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_conversation_hash", (q) =>
        q.eq("conversationHash", args.conversationHash),
      )
      .unique();

    if (existing) {
      logConvex("info", "save_duplicate", { conversationId: existing._id });
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
    const incomingToExistingName = new Map<string, string>();

    for (const link of args.identityLinks || []) {
      const incoming = normalize(link.incomingName);
      const existing = normalize(link.existingName);
      if (!incoming || !existing) continue;
      if (!incomingToExistingName.has(incoming)) {
        incomingToExistingName.set(incoming, existing);
      }
    }

    const findPersonByDisplayName = async (
      displayNameNormalized: string,
    ): Promise<Doc<"people"> | null> => {
      const parts = extractNameParts(displayNameNormalized);
      const first = normalize(parts.firstName);
      if (!first) return null;

      const candidates = await ctx.db
        .query("people")
        .withIndex("by_first_name_normalized", (q) => q.eq("firstNameNormalized", first))
        .take(200);

      for (const candidate of candidates) {
        const candidateDisplay = normalize(displayName(candidate.firstName, candidate.lastNames));
        if (candidateDisplay === displayNameNormalized) {
          return candidate;
        }
      }

      return null;
    };

    for (const person of args.people) {
      const personNameNormalized = normalize(person.name);
      const initialParts = extractNameParts(person.name);
      const initialLastNames = initialParts.lastNames
        .map((lastName) => normalize(lastName))
        .filter((lastName) => lastName.length > 0);
      const personKey = makePersonKey(initialParts.firstName, initialLastNames);

      const existingPerson = await ctx.db
        .query("people")
        .withIndex("by_person_key", (q) => q.eq("personKey", personKey))
        .unique();

      const linkedExistingName = incomingToExistingName.get(personNameNormalized);
      const linkedExistingPerson = linkedExistingName
        ? await findPersonByDisplayName(linkedExistingName)
        : null;

      const resolvedExistingPerson = linkedExistingPerson || existingPerson;

      if (linkedExistingName && !linkedExistingPerson) {
        logConvex("warn", "identity_link_target_not_found", {
          incomingName: person.name,
          requestedExistingName: linkedExistingName,
        });
      }

      if (
        linkedExistingPerson &&
        existingPerson &&
        linkedExistingPerson._id !== existingPerson._id
      ) {
        logConvex("info", "identity_link_overrode_person_key_match", {
          incomingName: person.name,
          linkedPersonId: linkedExistingPerson._id,
          personKeyMatchedId: existingPerson._id,
        });
      }

      const existingAliases = resolvedExistingPerson?.aliases ?? [];
      const allNameForms = [person.name, ...person.aliases, ...existingAliases];
      const primaryParts = resolvedExistingPerson
        ? { firstName: resolvedExistingPerson.firstName, lastNames: resolvedExistingPerson.lastNames }
        : initialParts;
      const lastNames = new Set<string>(primaryParts.lastNames);

      for (const lastName of resolvedExistingPerson?.lastNames || []) {
        const normalized = normalize(lastName);
        if (normalized) {
          lastNames.add(normalized);
        }
      }

      for (const form of allNameForms) {
        const parts = extractNameParts(form);
        for (const lastName of parts.lastNames) {
          const normalizedLastName = normalize(lastName);
          if (normalizedLastName) {
            lastNames.add(normalizedLastName);
          }
        }
      }

      const aliasByNormalized = new Map<string, string>();
      for (const alias of [...existingAliases, ...person.aliases]) {
        const normalizedAlias = normalize(alias);
        if (!normalizedAlias) continue;
        if (!aliasByNormalized.has(normalizedAlias)) {
          aliasByNormalized.set(normalizedAlias, alias);
        }
      }

      const tokens = [person.name, ...Array.from(aliasByNormalized.values())]
        .map(normalize)
        .filter((token) => token.length > 1);

      let speakerMatchCount = 0;
      let mentionOnlyMatchCount = 0;
      for (const message of args.messages) {
        const speaker = normalize(message.speaker);
        const text = message.text.toLowerCase();
        const speakerMatch = tokens.includes(speaker);
        const textMatch = tokens.some((token) => token.length > 2 && text.includes(token));

        if (speakerMatch) {
          speakerMatchCount += 1;
        }

        if (textMatch && !speakerMatch) {
          mentionOnlyMatchCount += 1;
        }
      }

      const hasSpeakerMatch = speakerMatchCount > 0;
      const hasMentionMatch = mentionOnlyMatchCount > 0;

      let personId: Id<"people">;

      if (resolvedExistingPerson) {
        const nextActive = new Set(resolvedExistingPerson.activeConversationId ?? []);
        const nextPassive = new Set(resolvedExistingPerson.passiveConversationId ?? []);

        if (hasSpeakerMatch) {
          nextActive.add(conversationId);
          nextPassive.delete(conversationId);
        } else if (hasMentionMatch && !nextActive.has(conversationId)) {
          nextPassive.add(conversationId);
        }

        await ctx.db.patch(resolvedExistingPerson._id, {
          activeConversationId: Array.from(nextActive),
          passiveConversationId: Array.from(nextPassive),
          firstName: resolvedExistingPerson.firstName,
          firstNameNormalized: resolvedExistingPerson.firstNameNormalized,
          lastNames: Array.from(lastNames),
          personKey: makePersonKey(resolvedExistingPerson.firstName, Array.from(lastNames)),
          aliases: Array.from(aliasByNormalized.values()),
          summary: mergeSummary(resolvedExistingPerson.summary, person.summary),
          activeMessageCount: resolvedExistingPerson.activeMessageCount + speakerMatchCount,
          passiveMessageCount: resolvedExistingPerson.passiveMessageCount + mentionOnlyMatchCount,
        });
        personId = resolvedExistingPerson._id;
      } else {
        personId = await ctx.db.insert("people", {
          activeConversationId: hasSpeakerMatch ? [conversationId] : [],
          passiveConversationId: !hasSpeakerMatch && hasMentionMatch ? [conversationId] : [],
          firstName: primaryParts.firstName,
          firstNameNormalized: normalize(primaryParts.firstName),
          lastNames: Array.from(lastNames),
          personKey: makePersonKey(primaryParts.firstName, Array.from(lastNames)),
          aliases: Array.from(aliasByNormalized.values()),
          summary: person.summary,
          activeMessageCount: speakerMatchCount,
          passiveMessageCount: mentionOnlyMatchCount,
          createdAt: now,
        });
      }

      personIdsByName.set(personNameNormalized, personId);
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

    logConvex("info", "save_done", { conversationId });

    return {
      conversationId,
      duplicate: false,
    };
  },
});

export const checkConversationHashes = query({
  args: { hashes: v.array(v.string()) },
  handler: async (ctx, args) => {
    logConvex("info", "hash_check_start", { hashCount: args.hashes.length });
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

    logConvex("info", "hash_check_done", { foundCount: found.length });
    return found;
  },
});

export const wipeAllData = mutation({
  args: {},
  handler: async (ctx) => {
    logConvex("warn", "wipe_start");
    let deleted = 0;

    const clearTable = async <TTable extends
      | "messagePeople"
      | "messageEvents"
      | "messageThemes"
      | "messages"
      | "events"
      | "themes"
      | "people"
      | "conversations">(table: TTable) => {
      while (true) {
        const batch = await ctx.db.query(table).take(500);
        if (batch.length === 0) break;
        for (const row of batch) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    };

    await clearTable("messagePeople");
    await clearTable("messageEvents");
    await clearTable("messageThemes");
    await clearTable("messages");
    await clearTable("events");
    await clearTable("themes");
    await clearTable("people");
    await clearTable("conversations");

    logConvex("warn", "wipe_done", { deleted });
    return { deleted };
  },
});

export const findPeopleByFirstNames = query({
  args: { firstNames: v.array(v.string()) },
  handler: async (ctx, args) => {
    logConvex("info", "find_people_by_first_names_start", { firstNameCount: args.firstNames.length });
    const requested = Array.from(
      new Set(args.firstNames.map((firstName) => normalize(firstName)).filter((firstName) => firstName.length > 0)),
    );

    const rows: Array<{
      firstName: string;
      personName: string;
      lastNames: string[];
      aliases: string[];
      activeConversationId: string[];
      passiveConversationId: string[];
    }> = [];

    const added = new Set<string>();

    for (const firstName of requested) {
      const matches = await ctx.db
        .query("people")
        .withIndex("by_first_name_normalized", (q) => q.eq("firstNameNormalized", firstName))
        .take(200);

      for (const person of matches) {
        if (added.has(person._id)) continue;
        added.add(person._id);

        rows.push({
          firstName,
          personName: displayName(person.firstName, person.lastNames),
          lastNames: person.lastNames,
          aliases: person.aliases,
          activeConversationId: person.activeConversationId,
          passiveConversationId: person.passiveConversationId,
        });
      }
    }

    logConvex("info", "find_people_by_first_names_done", { resultCount: rows.length });
    return rows;
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

    const messagePeople = await ctx.db
      .query("messagePeople")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(5000);

    const uniquePersonIds = new Set<Id<"people">>();
    for (const link of messagePeople) {
      uniquePersonIds.add(link.personId);
    }

    const people = [];
    for (const personId of uniquePersonIds) {
      const person = await ctx.db.get(personId);
      if (person) {
        people.push(person);
      }
    }

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
          name: displayName(person.firstName, person.lastNames),
          aliases: person.aliases,
          summary: person.summary,
          messageCount: person.activeMessageCount + person.passiveMessageCount,
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
