import { generateObject } from "ai";
import { z } from "zod";

import { formatMessagesForPrompt, runWithRetry, trimPrompt } from "@/lib/layers/common";
import { createLogger, errorMeta } from "@/lib/logger";
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

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function splitCompoundName(name: string): string[] {
  const cleaned = name.trim();
  if (!cleaned) return [];

  const segments = cleaned
    .split(/\s+(?:and|&)\s+/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return [cleaned];
  }

  // Split only simple combined names, not long phrases.
  const looksLikeNames = segments.every((segment) => {
    const words = segment.split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= 3;
  });

  if (!looksLikeNames) {
    return [cleaned];
  }

  return segments;
}

function splitCombinedPeople(people: PersonSummary[]): PersonSummary[] {
  const byName = new Map<string, PersonSummary>();

  const upsert = (person: PersonSummary) => {
    const key = normalize(person.name);
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        ...person,
        aliases: Array.from(new Set(person.aliases.map((alias) => alias.trim()).filter(Boolean))),
      });
      return;
    }

    const aliasSet = new Set([...existing.aliases, ...person.aliases].map((alias) => alias.trim()).filter(Boolean));
    byName.set(key, {
      ...existing,
      aliases: Array.from(aliasSet),
      summary: existing.summary.length >= person.summary.length ? existing.summary : person.summary,
      messageCount: existing.messageCount + person.messageCount,
    });
  };

  for (const person of people) {
    const splitNames = splitCompoundName(person.name);
    if (splitNames.length === 1) {
      upsert(person);
      continue;
    }

    const distributedCountBase = Math.floor(person.messageCount / splitNames.length);
    let remainder = person.messageCount % splitNames.length;

    for (const splitName of splitNames) {
      const splitMessageCount = distributedCountBase + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;

      upsert({
        name: splitName,
        aliases: Array.from(new Set([person.name, ...person.aliases])),
        summary: person.summary,
        messageCount: splitMessageCount,
      });
    }
  }

  return Array.from(byName.values());
}

export async function runPeopleLayer(
  messages: ParsedMessage[],
  model: ModelLike,
): Promise<PersonSummary[]> {
  const logger = createLogger("layers.people", {
    messageCount: messages.length,
  });
  const transcript = trimPrompt(formatMessagesForPrompt(messages));
  logger.info("start", { transcriptChars: transcript.length });

  try {
    const { object } = await runWithRetry(
      () =>
        generateObject({
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
        }),
      {
        operationName: "generate_people",
        logger,
        inputMeta: { transcriptChars: transcript.length },
      },
    );

    const split = splitCombinedPeople(object.people);
    logger.info("complete", {
      aiPeopleCount: object.people.length,
      finalPeopleCount: split.length,
    });
    return split;
  } catch (error) {
    logger.error("failed", errorMeta(error));
    throw error;
  }
}
