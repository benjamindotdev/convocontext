import { ParsedMessage } from "@/lib/types";

export function formatMessagesForPrompt(messages: ParsedMessage[]): string {
  return messages
    .map((message) => {
      const time = message.timestamp ? ` (${message.timestamp})` : "";
      return `L${message.line} | ${message.speaker}${time}: ${message.text}`;
    })
    .join("\n");
}

export function trimPrompt(input: string, maxChars = 120_000): string {
  if (input.length <= maxChars) {
    return input;
  }

  return `${input.slice(0, maxChars)}\n\n[TRUNCATED DUE TO LENGTH]`;
}
