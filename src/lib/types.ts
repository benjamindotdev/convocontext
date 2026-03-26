export type ParsedMessage = {
  speaker: string;
  text: string;
  timestamp?: string;
  line: number;
};

export type PersonSummary = {
  name: string;
  aliases: string[];
  summary: string;
  messageCount: number;
};

export type EventSummary = {
  title: string;
  description: string;
  participants: string[];
  timeframe: string;
  evidenceLines: number[];
  topics: string[];
};

export type ThemeSummary = {
  name: string;
  description: string;
  keywords: string[];
  eventTitles: string[];
  confidence: number;
};

export type ConversationAnalysis = {
  messages: ParsedMessage[];
  people: PersonSummary[];
  events: EventSummary[];
  themes: ThemeSummary[];
};
