import { generateObject } from "ai";
import { z } from "zod";

import { runWithRetry } from "@/lib/layers/common";
import { createLogger } from "@/lib/logger";
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

function bestMatchingThemeName(
  topic: string,
  event: EventSummary,
  currentThemes: ThemeSummary[],
  historicalThemes: ExistingThemeContext[],
): string | null {
  const targetTokens = new Set([
    ...tokenize(topic),
    ...event.topics.flatMap((t) => tokenize(t)),
    ...tokenize(event.title),
  ]);

  let bestName: string | null = null;
  let bestScore = 0;

  const candidates = [
    ...currentThemes.map((theme) => ({
      name: theme.name,
      keywords: theme.keywords,
      eventTitles: theme.eventTitles,
    })),
    ...historicalThemes,
  ];

  for (const candidate of candidates) {
    const candidateTokens = new Set([
      ...tokenize(candidate.name),
      ...candidate.keywords.flatMap((k) => tokenize(k)),
      ...candidate.eventTitles.flatMap((title) => tokenize(title)),
    ]);

    let overlap = 0;
    for (const token of targetTokens) {
      if (candidateTokens.has(token)) {
        overlap += 1;
      }
    }

    if (overlap > bestScore) {
      bestScore = overlap;
      bestName = candidate.name;
    }
  }

  return bestScore > 0 ? bestName : null;
}

type ExistingThemeContext = {
  name: string;
  description: string;
  keywords: string[];
  eventTitles: string[];
};

type RunThemesLayerOptions = {
  existingThemes?: ExistingThemeContext[];
};

export async function runThemesLayer(
  _messages: ParsedMessage[],
  events: EventSummary[],
  model: ModelLike,
  onProgress?: (themes: ThemeSummary[]) => void,
  options?: RunThemesLayerOptions,
): Promise<ThemeSummary[]> {
  const existingThemes = options?.existingThemes || [];
  const logger = createLogger("layers.themes", {
    eventCount: events.length,
    existingThemes: existingThemes.length,
  });
  const themes: ThemeSummary[] = [];

  logger.info("start", { eventCount: events.length });

  for (const event of events) {
    const topicList = Array.from(
      new Set((event.topics.length > 0 ? event.topics : [event.title]).map((topic) => topic.trim()).filter(Boolean)),
    );

    for (const topic of topicList) {
      let object:
        | {
            matchType: "existing" | "new";
            matchedThemeName?: string;
            newThemeName?: string;
            description: string;
            keywords: string[];
            confidence: number;
          }
        | null = null;

      try {
        const result = await runWithRetry(
          () =>
            generateObject({
              model,
              schema: assignmentSchema,
              temperature: 0.1,
              system:
                "You decide whether a topic belongs to an existing legal theme or requires a new theme.",
              prompt: [
                "Classify this topic into existing themes or create a new one.",
                "Return matchType='existing' only when semantic overlap is strong.",
                "Prefer reusing names from historical themes when the topic clearly matches.",
                "",
                `Topic: ${topic}`,
                `Event: ${event.title}`,
                `Event description: ${event.description}`,
                `Existing themes in this chat: ${JSON.stringify(themes)}`,
                `Historical themes: ${JSON.stringify(existingThemes)}`,
              ].join("\n"),
            }),
          {
            operationName: "assign_theme_for_topic",
            logger,
            inputMeta: {
              eventTitle: event.title,
              topic,
              existingThemes: themes.length,
            },
          },
        );

        object = result.object;
      } catch (error) {
        const fallbackName = bestMatchingThemeName(topic, event, themes, existingThemes);

        logger.warn("topic_assignment_fallback", {
          eventTitle: event.title,
          topic,
          fallbackTheme: fallbackName,
          error: error instanceof Error ? error.message : String(error),
        });

        object = {
          matchType: fallbackName ? "existing" : "new",
          matchedThemeName: fallbackName || undefined,
          newThemeName: fallbackName ? undefined : topic,
          description: `Fallback theme assignment for topic \"${topic}\" in event \"${event.title}\" due to model overload.`,
          keywords: [topic],
          confidence: fallbackName ? 0.35 : 0.2,
        };
      }

      if (!object) {
        continue;
      }

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

  logger.info("complete", { themeCount: themes.length });
  return themes;
}
