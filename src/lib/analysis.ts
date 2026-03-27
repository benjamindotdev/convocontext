import { anthropic } from "@ai-sdk/anthropic";

import { createLogger, errorMeta } from "@/lib/logger";
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
  const logger = createLogger("analysis.pipeline", {
    messageCount: messages.length,
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error("missing_api_key");
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to your environment.");
  }

  const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const model = anthropic(modelName);
  logger.info("start", { modelName });

  try {
    const people = await runPeopleLayer(messages, model);
    logger.info("people_done", { peopleCount: people.length });

    const events = await runEventsLayer(messages, people, model);
    logger.info("events_done", { eventsCount: events.length });

    const themes = await runThemesLayer(messages, events, model);
    logger.info("themes_done", { themesCount: themes.length });

    return {
      messages,
      people,
      events,
      themes,
    };
  } catch (error) {
    logger.error("failed", errorMeta(error));
    throw error;
  }
}
