import { generateObject } from "ai";
import { z } from "zod";

import { formatMessagesForPrompt, runWithRetry, trimPrompt } from "@/lib/layers/common";
import { createLogger, errorMeta } from "@/lib/logger";
import { EventSummary, ParsedMessage, PersonSummary } from "@/lib/types";

type ModelLike = Parameters<typeof generateObject>[0]["model"];

const eventsSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      participants: z.array(z.string()).default([]),
      timeframe: z.string(),
      evidenceLines: z.array(z.number().int().positive()).default([]),
      topics: z.array(z.string()).default([]),
    }),
  ),
});

type ExistingEventContext = {
  title: string;
  description: string;
  participants: string[];
  topics: string[];
};

type RunEventsLayerOptions = {
  existingEvents?: ExistingEventContext[];
};

function compactExistingEvents(events: ExistingEventContext[], limit = 20): ExistingEventContext[] {
  return events.slice(0, limit).map((event) => ({
    title: event.title,
    description: event.description.slice(0, 220),
    participants: event.participants.slice(0, 8),
    topics: event.topics.slice(0, 8),
  }));
}

export async function runEventsLayer(
  messages: ParsedMessage[],
  people: PersonSummary[],
  model: ModelLike,
  options?: RunEventsLayerOptions,
): Promise<EventSummary[]> {
  const existingEvents = options?.existingEvents || [];
  const compactEvents = compactExistingEvents(existingEvents, 20);
  const logger = createLogger("layers.events", {
    messageCount: messages.length,
    peopleCount: people.length,
    existingEvents: existingEvents.length,
  });
  // Keep prompts below org TPM limits for large chats.
  const transcript = trimPrompt(formatMessagesForPrompt(messages), 28_000);
  logger.info("start", { transcriptChars: transcript.length });

  try {
    const { object } = await runWithRetry(
      () =>
        generateObject({
          model,
          schema: eventsSchema,
          temperature: 0.2,
          system:
            "You are extracting legally useful events from a WhatsApp conversation. Keep claims grounded in evidence lines.",
          prompt: [
            "Identify concrete events or incidents mentioned or implied in this conversation.",
            "Rules:",
            "- Prefer factual, timestamped, verifiable incidents",
            "- Include evidenceLines as line numbers from the transcript",
            "- Participants should reference names from known people where possible",
            "- topics should be short labels like 'payment', 'threat', 'meeting', 'property'",
            "- If an incident appears to match an existing event, reuse the same event title",
            "",
            `Known people: ${JSON.stringify(people.slice(0, 60))}`,
            `Existing event context: ${JSON.stringify(compactEvents)}`,
            "",
            transcript,
          ].join("\n"),
        }),
      {
        operationName: "generate_events",
        logger,
        baseDelayMs: 5_000,
        inputMeta: {
          transcriptChars: transcript.length,
          compactExistingEvents: compactEvents.length,
        },
      },
    );

    logger.info("complete", { eventsCount: object.events.length });
    return object.events;
  } catch (error) {
    logger.error("failed", errorMeta(error));
    throw error;
  }
}
