import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    title: v.string(),
    rawText: v.string(),
    conversationHash: v.string(),
    createdAt: v.number(),
    analyzedAt: v.number(),
    status: v.optional(v.union(v.literal("phase1_draft"), v.literal("completed"))),
    draftPeople: v.optional(v.array(v.any())),
  }).index("by_conversation_hash", ["conversationHash"]),
  messages: defineTable({
    conversationId: v.id("conversations"),
    line: v.number(),
    speaker: v.string(),
    text: v.string(),
    timestamp: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_conversation_and_line", ["conversationId", "line"]),
  people: defineTable({
    activeConversationId: v.array(v.id("conversations")),
    passiveConversationId: v.array(v.id("conversations")),
    firstName: v.string(),
    firstNameNormalized: v.string(),
    lastNames: v.array(v.string()),
    personKey: v.string(),
    aliases: v.array(v.string()),
    summary: v.string(),
    activeMessageCount: v.number(),
    passiveMessageCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_person_key", ["personKey"])
    .index("by_first_name_normalized", ["firstNameNormalized"]),
  events: defineTable({
    conversationId: v.id("conversations"),
    title: v.string(),
    titleNormalized: v.string(),
    description: v.string(),
    participants: v.array(v.string()),
    timeframe: v.string(),
    evidenceLines: v.array(v.number()),
    topics: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_and_title_normalized", ["conversationId", "titleNormalized"])
    .index("by_title_normalized", ["titleNormalized"]),
  themes: defineTable({
    conversationId: v.id("conversations"),
    name: v.string(),
    nameNormalized: v.string(),
    description: v.string(),
    keywords: v.array(v.string()),
    eventTitles: v.array(v.string()),
    confidence: v.number(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_and_name_normalized", ["conversationId", "nameNormalized"])
    .index("by_name_normalized", ["nameNormalized"]),
  messagePeople: defineTable({
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    personId: v.id("people"),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_message_and_person", ["messageId", "personId"])
    .index("by_person", ["personId"]),
  messageEvents: defineTable({
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    eventId: v.id("events"),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_message_and_event", ["messageId", "eventId"])
    .index("by_event", ["eventId"]),
  messageThemes: defineTable({
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    themeId: v.id("themes"),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_message_and_theme", ["messageId", "themeId"])
    .index("by_theme", ["themeId"]),
});
