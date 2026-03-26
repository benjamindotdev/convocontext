import { ParsedMessage } from "@/lib/types";

const CHAT_PATTERNS = [
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APMapm]{0,2})\s-\s([^:]+):\s([\s\S]*)$/,
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APMapm]{0,2})\]\s([^:]+):\s([\s\S]*)$/,
];

export function parseWhatsAppConversation(raw: string): ParsedMessage[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const messages: ParsedMessage[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() ?? "";

    if (!line) {
      continue;
    }

    let matched = false;

    for (const pattern of CHAT_PATTERNS) {
      const result = line.match(pattern);

      if (!result) {
        continue;
      }

      const [, date, time, speaker, text] = result;

      messages.push({
        speaker: speaker.trim(),
        text: text.trim(),
        timestamp: `${date} ${time}`,
        line: index + 1,
      });

      matched = true;
      break;
    }

    if (!matched && messages.length > 0) {
      const previous = messages[messages.length - 1];
      previous.text = `${previous.text}\n${line}`.trim();
    }
  }

  return messages;
}
