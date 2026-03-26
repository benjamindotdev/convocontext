import { anthropic } from "@ai-sdk/anthropic";

import { runEventsLayer } from "@/lib/layers/events";
import { runPeopleLayer } from "@/lib/layers/people";
import { runThemesLayer } from "@/lib/layers/themes";
import { ConversationAnalysis, ParsedMessage } from "@/lib/types";

export function suggestConversationTitle(messages: ParsedMessage[]): string {
  const participants = Array.from(new Set(messages.map((m) => m.speaker))).slice(0, 2);
  const stamp = new Date().toISOString().slice(0, 10);

  if (participants.length === 0) {
    return `Conversation ${stamp}`;
  }

  return `${participants.join(" vs ")} - ${stamp}`;
}

export async function analyzeConversation(
  messages: ParsedMessage[],
): Promise<ConversationAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to your environment.");
  }

  const model = anthropic("claude-3-5-sonnet-latest");

  const people = await runPeopleLayer(messages, model);
  const events = await runEventsLayer(messages, people, model);
  const themes = await runThemesLayer(messages, events, model);

  return {
    messages,
    people,
    events,
    themes,
  };
}
