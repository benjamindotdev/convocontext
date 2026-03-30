import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { normalize, eventSignalTokens } from "../src/lib/shared";

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

function normalizedLastNameSet(values: string[]): Set<string> {
  const stopWords = new Set([
    "and",
    "in",
    "on",
    "at",
    "the",
    "a",
    "an",
    "of",
  ]);

  return new Set(
    values
      .flatMap((value) =>
        value
          .split(/[^a-zA-Z0-9]+/g)
          .map((part) => normalize(part)),
      )
      .filter((value) => value.length >= 3)
      .filter((value) => !stopWords.has(value)),
  );
}

function isSubset(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function areLastNamesCompatible(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) {
    return true;
  }

  if (isSubset(left, right) || isSubset(right, left)) {
    return true;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
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

function mergeUniqueStrings(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const value of list) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const key = normalize(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }

  return merged;
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

export const savePhase1Draft = mutation({
  args: {
    title: v.string(),
    rawText: v.string(),
    conversationHash: v.string(),
    messages: v.array(messageValidator),
    people: v.array(personValidator)
  },
  handler: async (ctx, args) => {
    logConvex("info", "save_draft_start", {
      title: args.title,
      rawChars: args.rawText.length,
      messageCount: args.messages.length,
      peopleCount: args.people.length,
    });

    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_conversation_hash", (q) =>
        q.eq("conversationHash", args.conversationHash),
      )
      .unique();

    if (existing) {
      logConvex("info", "save_draft_duplicate", { conversationId: existing._id });
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
      status: "phase1_draft",
      draftPeople: args.people,
      createdAt: now,
      analyzedAt: now,
    });

    for (const message of args.messages) {
      await ctx.db.insert("messages", {
        conversationId,
        line: message.line,
        speaker: message.speaker,
        text: message.text,
        timestamp: message.timestamp,
        createdAt: now,
      });
    }

    logConvex("info", "save_draft_done", { conversationId });

    return {
      conversationId,
      duplicate: false,
    };
  },
});

export const commitGlobalIdentities = mutation({
  args: {
    conversationId: v.id("conversations"),
    people: v.array(personValidator),
    identityLinks: v.optional(v.array(identityLinkValidator)),
  },
  handler: async (ctx, args) => {
    const { conversationId } = args;
    const now = Date.now();

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_and_line", (q) => q.eq("conversationId", conversationId))
      .collect();

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

        const aliasMatched = (candidate.aliases || []).some(
          (alias) => normalize(alias) === displayNameNormalized,
        );
        if (aliasMatched) {
          return candidate;
        }
      }

      return null;
    };

    const resolveLinkedExistingNameForPerson = (person: {
      name: string;
      aliases: string[];
    }): string | undefined => {
      const personFirst = normalize(extractNameParts(person.name).firstName);
      const candidates = [person.name, ...person.aliases, personFirst]
        .map((value) => normalize(value))
        .filter((value) => value.length > 0);

      for (const candidate of candidates) {
        const linked = incomingToExistingName.get(candidate);
        if (linked) {
          return linked;
        }
      }

      return undefined;
    };

    const findCompatiblePersonByFirstName = async (person: {
      name: string;
      aliases: string[];
    }): Promise<Doc<"people"> | null> => {
      const initialParts = extractNameParts(person.name);
      const firstNameNormalized = normalize(initialParts.firstName);
      if (!firstNameNormalized) return null;

      const incomingLastNames = normalizedLastNameSet([
        ...initialParts.lastNames,
        ...person.aliases.flatMap((alias) => extractNameParts(alias).lastNames),
      ]);

      const incomingNames = new Set(
        [person.name, ...person.aliases]
          .map((name) => normalize(name))
          .filter((name) => name.length > 0),
      );

      const candidates = await ctx.db
        .query("people")
        .withIndex("by_first_name_normalized", (q) => q.eq("firstNameNormalized", firstNameNormalized))
        .take(200);

      let best: { person: Doc<"people">; score: number } | null = null;

      for (const candidate of candidates) {
        const candidateDisplay = displayName(candidate.firstName, candidate.lastNames);
        const candidateDisplayNormalized = normalize(candidateDisplay);
        if (candidateDisplayNormalized === normalize(person.name)) {
          return candidate;
        }

        const candidateLastNames = normalizedLastNameSet(candidate.lastNames);
        if (!areLastNamesCompatible(incomingLastNames, candidateLastNames)) {
          continue;
        }

        let score = 0;
        if (incomingLastNames.size > 0 && candidateLastNames.size > 0) {
          score += 3;
        } else {
          score += 1;
        }

        const aliasOverlap = (candidate.aliases || []).some((alias) => incomingNames.has(normalize(alias)));
        if (aliasOverlap || incomingNames.has(candidateDisplayNormalized)) {
          score += 2;
        }

        if (!best || score > best.score) {
          best = { person: candidate, score };
        }
      }

      return best?.person ?? null;
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

      const linkedExistingName = resolveLinkedExistingNameForPerson(person);
      const linkedExistingPerson = linkedExistingName
        ? await findPersonByDisplayName(linkedExistingName)
        : null;
      const firstNameCompatiblePerson = !linkedExistingPerson && !existingPerson
        ? await findCompatiblePersonByFirstName(person)
        : null;

      const resolvedExistingPerson = linkedExistingPerson || existingPerson || firstNameCompatiblePerson;

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

      if (
        firstNameCompatiblePerson &&
        !linkedExistingPerson &&
        !existingPerson
      ) {
        logConvex("info", "first_name_compatibility_match_applied", {
          incomingName: person.name,
          matchedPersonId: firstNameCompatiblePerson._id,
          matchedDisplayName: displayName(firstNameCompatiblePerson.firstName, firstNameCompatiblePerson.lastNames),
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
      for (const message of messages) {
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

    const personLinkSet = new Set<string>();

    for (const person of args.people) {
      const personId = personIdsByName.get(normalize(person.name));
      if (!personId) continue;

      const tokens = [person.name, ...person.aliases]
        .map(normalize)
        .filter((token) => token.length > 1);

      for (const message of messages) {
        const speaker = normalize(message.speaker);
        const text = message.text.toLowerCase();
        const speakerMatch = tokens.includes(speaker);
        const textMatch = tokens.some((token) => token.length > 2 && text.includes(token));

        if (!speakerMatch && !textMatch) {
          continue;
        }

        const key = `${message._id}:${personId}`;
        if (personLinkSet.has(key)) continue;
        personLinkSet.add(key);

        await ctx.db.insert("messagePeople", {
          conversationId,
          messageId: message._id,
          personId,
          createdAt: now,
        });
      }
    }

    logConvex("info", "commit_identities_done", { conversationId });
  },
});

export const savePhase3Analysis = mutation({
  args: {
    conversationId: v.id("conversations"),
    events: v.array(eventValidator),
    themes: v.array(themeValidator),
  },
  handler: async (ctx, args) => {
    const { conversationId } = args;
    const now = Date.now();

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_and_line", (q) => q.eq("conversationId", conversationId))
      .collect();

    const messageIdsByLine = new Map<number, Id<"messages">>();
    for (const m of messages) {
      messageIdsByLine.set(m.line, m._id);
    }

    const eventIdsByTitle = new Map<string, Id<"events">>();
    const eventMessageIds = new Map<string, Set<Id<"messages">>>();

    for (const event of args.events) {
      const eventKey = normalize(event.title);
      const existingGlobalEvents = await ctx.db
        .query("events")
        .withIndex("by_title_normalized", (q) => q.eq("titleNormalized", eventKey))
        .take(1);

      let eventId: Id<"events">;

      if (existingGlobalEvents.length > 0) {
        const existingEvent = existingGlobalEvents[0];

        await ctx.db.patch(existingEvent._id, {
          description: mergeSummary(existingEvent.description, event.description),
          participants: mergeUniqueStrings(existingEvent.participants, event.participants),
          topics: mergeUniqueStrings(existingEvent.topics, event.topics),
          timeframe: mergeSummary(existingEvent.timeframe, event.timeframe),
          evidenceLines: Array.from(new Set([...existingEvent.evidenceLines, ...event.evidenceLines])),
        });

        eventId = existingEvent._id;
      } else {
        eventId = await ctx.db.insert("events", {
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
      }

      eventIdsByTitle.set(eventKey, eventId);

      const linkedMessageIds = eventMessageIds.get(eventKey) || new Set<Id<"messages">>();
      for (const line of event.evidenceLines) {
        const messageId = messageIdsByLine.get(line);
        if (messageId) linkedMessageIds.add(messageId);
      }

      if (linkedMessageIds.size === 0) {
        const signalTokens = eventSignalTokens(event);

        for (const message of messages) {
          const text = message.text.toLowerCase();
          const matchesSignal = signalTokens.some((token) => text.includes(token));

          if (matchesSignal) {
            linkedMessageIds.add(message._id);
          }
        }
      }

      eventMessageIds.set(eventKey, linkedMessageIds);
    }

    const themeIdsByName = new Map<string, Id<"themes">>();

    for (const theme of args.themes) {
      const themeKey = normalize(theme.name);
      const existingGlobalThemes = await ctx.db
        .query("themes")
        .withIndex("by_name_normalized", (q) => q.eq("nameNormalized", themeKey))
        .take(1);

      let themeId: Id<"themes">;

      if (existingGlobalThemes.length > 0) {
        const existingTheme = existingGlobalThemes[0];

        await ctx.db.patch(existingTheme._id, {
          description: mergeSummary(existingTheme.description, theme.description),
          keywords: mergeUniqueStrings(existingTheme.keywords, theme.keywords),
          eventTitles: mergeUniqueStrings(existingTheme.eventTitles, theme.eventTitles),
          confidence: Math.max(existingTheme.confidence, theme.confidence),
        });

        themeId = existingTheme._id;
      } else {
        themeId = await ctx.db.insert("themes", {
          conversationId,
          name: theme.name,
          nameNormalized: themeKey,
          description: theme.description,
          keywords: theme.keywords,
          eventTitles: theme.eventTitles,
          confidence: theme.confidence,
          createdAt: now,
        });
      }

      themeIdsByName.set(themeKey, themeId);
    }

    const eventLinkSet = new Set<string>();

    for (const [eventKey, eventMessageIdsSet] of eventMessageIds.entries()) {
      const eventId = eventIdsByTitle.get(eventKey);
      if (!eventId) continue;

      for (const messageId of eventMessageIdsSet) {
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

        for (const message of messages) {
          if (keywordTokens.some((token) => message.text.toLowerCase().includes(token))) {
            linkedMessageIds.add(message._id);
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

    await ctx.db.patch(conversationId, {
      status: "completed",
      analyzedAt: now,
    });

    logConvex("info", "save_phase3_done", { conversationId });
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
    }> = [];

    for (const req of requested) {
      const matches = await ctx.db
        .query("people")
        .withIndex("by_first_name_normalized", (q) => q.eq("firstNameNormalized", req))
        .take(50);

      for (const match of matches) {
        rows.push({
          firstName: match.firstName,
          personName: displayName(match.firstName, match.lastNames),
          lastNames: match.lastNames,
        });
      }
    }

    logConvex("info", "find_people_by_first_names_done", { matchCount: rows.length });
    return rows;
  },
});

export const listPeopleForIdentityReview = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const rawPeople = await ctx.db
      .query("people")
      .withIndex("by_creation_time")
      .order("desc")
      .take(100);

    const people: Array<{
      id: Id<"people">;
      name: string;
      firstName: string;
      lastNames: string[];
      aliases: string[];
      summary: string;
    }> = [];

    for (const p of rawPeople) {
      people.push({
        id: p._id,
        name: displayName(p.firstName, p.lastNames),
        firstName: p.firstName,
        lastNames: p.lastNames,
        aliases: p.aliases || [],
        summary: p.summary || "",
      });
    }

    return people;
  },
});

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("conversations").order("desc").take(50);
    return rows.map((row) => ({
      _id: row._id,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
      analyzedAt: row.analyzedAt,
    }));
  },
});

export const getGlobalContext = query({
  args: {},
  handler: async (ctx) => {
    const people = await ctx.db.query("people").order("desc").take(100);
    const events = await ctx.db.query("events").order("desc").take(100);
    const themes = await ctx.db.query("themes").order("desc").take(100);

    return {
      people: people.map((p) => ({
        id: p._id,
        name: displayName(p.firstName, p.lastNames),
        summary: p.summary,
        aliases: p.aliases,
      })),
      events: events.map((e) => ({
        id: e._id,
        title: e.title,
        description: e.description,
        participants: e.participants,
        timeframe: e.timeframe,
      })),
      themes: themes.map((t) => ({
        id: t._id,
        name: t.name,
        description: t.description,
      })),
    };
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
      .collect();

    const messagePeople = await ctx.db
      .query("messagePeople")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const messageEvents = await ctx.db
      .query("messageEvents")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const messageThemes = await ctx.db
      .query("messageThemes")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const peopleDocs = await Promise.all(
      Array.from(new Set(messagePeople.map((mp) => mp.personId))).map((id) => ctx.db.get(id)),
    );

    const eventDocs = await Promise.all(
      Array.from(new Set(messageEvents.map((me) => me.eventId))).map((id) => ctx.db.get(id)),
    );

    const themeDocs = await Promise.all(
      Array.from(new Set(messageThemes.map((mt) => mt.themeId))).map((id) => ctx.db.get(id)),
    );

    return {
      conversation,
      messages,
      people: peopleDocs.filter((d): d is Doc<"people"> => d !== null),
      events: eventDocs.filter((d): d is Doc<"events"> => d !== null),
      themes: themeDocs.filter((d): d is Doc<"themes"> => d !== null),
      links: {
        messagePeople,
        messageEvents,
        messageThemes,
      },
    };
  },
});
