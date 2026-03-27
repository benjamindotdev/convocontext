import { generateObject } from "ai";
import { z } from "zod";

import { EventSummary, ParsedMessage, ThemeSummary } from "@/lib/types";

type ModelLike = Parameters<typeof generateObject>[0]["model"];

const assignmentSchema = z.object({
  matchType: z.enum(["existing", "new"]),
  matchedThemeName: z.string().optional(),
  newThemeName: z.string().optional(),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

function normalizeThemeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function runThemesLayer(
  _messages: ParsedMessage[],
  events: EventSummary[],
  model: ModelLike,
  onProgress?: (themes: ThemeSummary[]) => void,
): Promise<ThemeSummary[]> {
  const themes: ThemeSummary[] = [];

  for (const event of events) {
    const topicList = event.topics.length > 0 ? event.topics : [event.title];

    for (const topic of topicList) {
      const { object } = await generateObject({
        model,
        schema: assignmentSchema,
        temperature: 0.1,
        system:
          "You decide whether a topic belongs to an existing legal theme or requires a new theme.",
        prompt: [
          "Classify this topic into existing themes or create a new one.",
          "Return matchType='existing' only when semantic overlap is strong.",
          "",
          `Topic: ${topic}`,
          `Event: ${event.title}`,
          `Event description: ${event.description}`,
          `Existing themes: ${JSON.stringify(themes)}`,
        ].join("\n"),
      });

      if (object.matchType === "existing" && object.matchedThemeName) {
        const match = themes.find(
          (theme) =>
            theme.name.toLowerCase() === object.matchedThemeName?.toLowerCase(),
        );

        if (match) {
          match.eventTitles = Array.from(new Set([...match.eventTitles, event.title]));
          match.keywords = Array.from(new Set([...match.keywords, ...object.keywords]));
          match.confidence = Math.max(match.confidence, object.confidence);
          onProgress?.([...themes]);
          continue;
        }
      }

      const newName = normalizeThemeName(
        object.newThemeName || object.matchedThemeName || topic,
      );

      const existingWithSameName = themes.find(
        (theme) => theme.name.toLowerCase() === newName.toLowerCase(),
      );

      if (existingWithSameName) {
        existingWithSameName.eventTitles = Array.from(
          new Set([...existingWithSameName.eventTitles, event.title]),
        );
        existingWithSameName.keywords = Array.from(
          new Set([...existingWithSameName.keywords, ...object.keywords]),
        );
        existingWithSameName.confidence = Math.max(
          existingWithSameName.confidence,
          object.confidence,
        );
        onProgress?.([...themes]);
        continue;
      }

      themes.push({
        name: newName,
        description: object.description,
        keywords: object.keywords,
        eventTitles: [event.title],
        confidence: object.confidence,
      });

      onProgress?.([...themes]);
    }
  }

  return themes;
}
