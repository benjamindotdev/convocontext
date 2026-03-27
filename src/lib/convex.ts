import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const convexFns = {
  saveConversationAnalysis: makeFunctionReference<"mutation">(
    "conversations:saveConversationAnalysis",
  ),
  checkConversationHashes: makeFunctionReference<"query">(
    "conversations:checkConversationHashes",
  ),
  findPeopleByFirstNames: makeFunctionReference<"query">(
    "conversations:findPeopleByFirstNames",
  ),
  listConversations: makeFunctionReference<"query">(
    "conversations:listConversations",
  ),
  getConversationWithAnalysis: makeFunctionReference<"query">(
    "conversations:getConversationWithAnalysis",
  ),
};

export function getConvexAdminClient(): ConvexHttpClient | null {
  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    return null;
  }

  const client = new ConvexHttpClient(convexUrl);

  return client;
}
