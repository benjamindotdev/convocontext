import { generateObject } from "ai";
import { z } from "zod";

import { formatMessagesForPrompt, trimPrompt } from "@/lib/layers/common";
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

export async function runEventsLayer(
  messages: ParsedMessage[],
  people: PersonSummary[],
  model: ModelLike,
): Promise<EventSummary[]> {
  const transcript = trimPrompt(formatMessagesForPrompt(messages));

  const { object } = await generateObject({
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
      "",
      `Known people: ${JSON.stringify(people)}`,
      "",
      transcript,
    ].join("\n"),
  });

  return object.events;
}
