import { mutation, query } from "./_generated/server";
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

export const saveConversationAnalysis = mutation({
  args: {
    title: v.string(),
    rawText: v.string(),
    messages: v.array(messageValidator),
    people: v.array(personValidator),
    events: v.array(eventValidator),
    themes: v.array(themeValidator),
  },
  handler: async (ctx, args) => {
    const conversationId = await ctx.db.insert("conversations", {
      title: args.title,
      rawText: args.rawText,
      createdAt: Date.now(),
    });

    await ctx.db.insert("analyses", {
      conversationId,
      messages: args.messages,
      people: args.people,
      events: args.events,
      themes: args.themes,
      createdAt: Date.now(),
    });

    return conversationId;
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

    const analysis = await ctx.db
      .query("analyses")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .first();

    return {
      conversation,
      analysis,
    };
  },
});
