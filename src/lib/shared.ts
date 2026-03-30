export function normalize(value: string): string {
  return value.toLowerCase().trim();
}

export const EVENT_LINK_STOP_WORDS = new Set([
  "the", "and", "that", "with", "from", "this", "your", "have", "been",
  "were", "what", "when", "where", "which", "while", "would", "could",
  "should", "about", "there", "their", "them", "they", "just", "very",
  "more", "some",
]);

export function eventSignalTokens(event: {
  title: string;
  description: string;
  topics: string[];
}): string[] {
  const raw = `${event.title} ${event.description} ${event.topics.join(" ")}`.toLowerCase();
  const words = raw
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !EVENT_LINK_STOP_WORDS.has(word));

  return Array.from(new Set(words));
}
