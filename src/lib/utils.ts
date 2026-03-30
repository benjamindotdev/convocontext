import {
  ChatStatus,
  ParsedMessage,
  MessageRef,
  ConversationAnalysis,
  StreamEvent,
  StreamPayload,
} from "@/lib/types";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalize(value: string): string {
  return value.toLowerCase().trim();
}

export function parseChatTimestamp(
  timestamp: string | undefined,
): number | null {
  if (!timestamp) return null;

  const normalized = timestamp.trim();
  const match = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,]+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/,
  );

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    let hour = Number(match[4]);
    const minute = Number(match[5]);
    const ampm = match[6]?.toLowerCase();

    if (year < 100) {
      year += 2000;
    }

    if (ampm === "pm" && hour < 12) {
      hour += 12;
    }
    if (ampm === "am" && hour === 12) {
      hour = 0;
    }

    const value = new Date(year, month - 1, day, hour, minute).getTime();
    return Number.isFinite(value) ? value : null;
  }

  const fallback = Date.parse(normalized);
  return Number.isNaN(fallback) ? null : fallback;
}

export function firstName(value: string): string {
  return value.trim().split(/\s+/)[0]?.toLowerCase() || "";
}

export function inferAddressee(
  message: MessageRef,
  participants: string[],
): string {
  const text = message.text.trim();
  const lowered = text.toLowerCase();
  const speakerName = message.speaker.toLowerCase();

  const matches = new Set<string>();

  const directStartMatch = text.match(/^([A-Za-z][A-Za-z'\-]+)\s*[,:-]/);
  if (directStartMatch) {
    const candidate = directStartMatch[1].toLowerCase();
    const direct = participants.find((participant) => {
      const p = participant.toLowerCase();
      if (p === speakerName) return false;
      const pFirst = firstName(participant);
      return pFirst === candidate || p === candidate;
    });
    if (direct) {
      matches.add(direct);
    }
  }

  for (const participant of participants) {
    const normalized = participant.toLowerCase();
    if (normalized === speakerName) continue;

    const token = firstName(participant);
    if (!token || token.length < 3) continue;

    if (lowered.includes(token)) {
      matches.add(participant);
    }
  }

  if (matches.size === 0) {
    return "Group chat";
  }

  return Array.from(matches).join(", ");
}

export function isDirectResponseToNext(
  message: MessageRef,
  next: MessageRef | undefined,
): boolean {
  if (!next) return false;
  if (next.speaker === message.speaker) return false;

  const currentTs = parseChatTimestamp(message.timestamp);
  const nextTs = parseChatTimestamp(next.timestamp);

  if (currentTs && nextTs) {
    const diffMs = nextTs - currentTs;
    if (diffMs >= 0 && diffMs <= 45 * 60 * 1000) {
      return true;
    }
  }

  return next.line - message.line <= 8;
}

export function isConversationBreak(
  message: MessageRef,
  next: MessageRef | undefined,
): boolean {
  if (!next) return false;

  const currentTs = parseChatTimestamp(message.timestamp);
  const nextTs = parseChatTimestamp(next.timestamp);

  if (currentTs && nextTs) {
    const diffMs = nextTs - currentTs;
    if (diffMs > 12 * 60 * 60 * 1000) {
      return true;
    }

    const currentDay = new Date(currentTs).toDateString();
    const nextDay = new Date(nextTs).toDateString();
    if (currentDay !== nextDay && diffMs > 3 * 60 * 60 * 1000) {
      return true;
    }
  }

  return next.line - message.line > 120;
}



export function eventSignalTokens(event: {
  title: string;
  description: string;
  topics: string[];
}): string[] {
  const raw =
    `${event.title} ${event.description} ${event.topics.join(" ")}`.toLowerCase();
  const words = raw
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !EVENT_LINK_STOP_WORDS.has(word));

  return Array.from(new Set(words));
}

export function prettyStatus(status: ChatStatus): string {
  if (status === "queued") return "Queued";
  if (status === "analyzing") return "Analyzing";
  if (status === "done") return "Done";
  if (status === "duplicate") return "Uploaded Previously";
  return "Error";
}

export function statusVariant(
  status: ChatStatus,
): "secondary" | "outline" | "destructive" {
  if (status === "done" || status === "duplicate") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

export function emptyAnalysis(
  messages: ParsedMessage[] = [],
): ConversationAnalysis {
  return {
    messages,
    people: [],
    events: [],
    themes: [],
  };
}

export function parseSseBlock(block: string): StreamEvent | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));

  if (!eventLine || !dataLine) {
    return null;
  }

  const event = eventLine.slice("event:".length).trim();
  const payload = dataLine.slice("data:".length).trim();

  return {
    event,
    data: JSON.parse(payload) as StreamPayload,
  };
}

export function latestEventTimestamp(event: { linkedMessages: Pick<MessageRef, "timestamp">[] }): number {
  let latest = 0;
  for (const message of event.linkedMessages) {
    const value = parseChatTimestamp(message.timestamp) ?? 0;
    if (value > latest) latest = value;
  }
  return latest;
}


export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}



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
