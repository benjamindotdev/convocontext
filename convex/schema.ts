import { defineSchema, defineTable } from "convex/server";
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

export default defineSchema({
  conversations: defineTable({
    title: v.string(),
    rawText: v.string(),
    createdAt: v.number(),
  }),
  analyses: defineTable({
    conversationId: v.id("conversations"),
    messages: v.array(messageValidator),
    people: v.array(personValidator),
    events: v.array(eventValidator),
    themes: v.array(themeValidator),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
});
