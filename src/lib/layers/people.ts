import { generateObject } from "ai";
import { z } from "zod";

import { formatMessagesForPrompt, trimPrompt } from "@/lib/layers/common";
import { ParsedMessage, PersonSummary } from "@/lib/types";

type ModelLike = Parameters<typeof generateObject>[0]["model"];

const peopleSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()).default([]),
      summary: z.string(),
      messageCount: z.number().int().nonnegative(),
    }),
  ),
});

export async function runPeopleLayer(
  messages: ParsedMessage[],
  model: ModelLike,
): Promise<PersonSummary[]> {
  const transcript = trimPrompt(formatMessagesForPrompt(messages));

  const { object } = await generateObject({
    model,
    schema: peopleSchema,
    temperature: 0.1,
    system:
      "You are a legal-grade conversation analyst. Identify unique individuals from chat speaker labels and references while avoiding duplication.",
    prompt: [
      "Return every meaningful person in this WhatsApp conversation.",
      "Each person must include:",
      "- canonical name",
      "- aliases (short forms, alternate labels)",
      "- factual summary of role in this conversation",
      "- messageCount (number of directly authored messages when possible)",
      "If uncertain, preserve ambiguity in summary instead of inventing facts.",
      "",
      transcript,
    ].join("\n"),
  });

  return object.people;
}
