import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const convexFns = {
  saveConversationAnalysis: makeFunctionReference<"mutation">("conversations:saveConversationAnalysis"),
  savePhase1Draft: makeFunctionReference<"mutation">("conversations:savePhase1Draft"),
  commitGlobalIdentities: makeFunctionReference<"mutation">("conversations:commitGlobalIdentities"),
  savePhase3Analysis: makeFunctionReference<"mutation">("conversations:savePhase3Analysis"),
  checkConversationHashes: makeFunctionReference<"query">("conversations:checkConversationHashes"),
  getPendingConversations: makeFunctionReference<"query">("conversations:getPendingConversations"),
  findPeopleByFirstNames: makeFunctionReference<"query">(
    "conversations:findPeopleByFirstNames",
  ),
  listPeopleForIdentityReview: makeFunctionReference<"query">(
    "conversations:listPeopleForIdentityReview",
  ),
  listConversations: makeFunctionReference<"query">(
    "conversations:listConversations",
  ),
  getConversationWithAnalysis: makeFunctionReference<"query">(
    "conversations:getConversationWithAnalysis",
  ),
  getGlobalContext: makeFunctionReference<"query">(
    "conversations:getGlobalContext",
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
