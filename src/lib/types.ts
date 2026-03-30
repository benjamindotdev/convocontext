import { PeopleReviewPerson } from "@/components/PeopleReviewModal";
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

export type ChatStatus = "queued" | "analyzing" | "done" | "error" | "duplicate";

export type MessageRef = {
  id: string;
  chat: string;
  line: number;
  speaker: string;
  timestamp: string | undefined;
  text: string;
};

export type SessionChat = {
  id: string;
  fileName: string;
  text: string;
  conversationHash: string;
  conversationId?: string;
  status: ChatStatus;
  title?: string;
  error?: string;
  analysis?: ConversationAnalysis;
};

export type LibraryConversation = {
  _id: string;
  title: string;
  conversationHash?: string;
  createdAt: number;
  analyzedAt?: number;
};

export type UnifiedPerson = {
  name: string;
  aliases: string[];
  chats: string[];
  messageCount: number;
  relatedEvents: Array<{ title: string; chat: string }>;
  relatedThemes: Array<{ name: string; chat: string }>;
  linkedMessages: MessageRef[];
};

export type UnifiedEvent = {
  title: string;
  chats: string[];
  participants: string[];
  topics: string[];
  descriptions: string[];
  linkedMessages: MessageRef[];
};

export type UnifiedTheme = {
  name: string;
  chats: string[];
  eventTitles: string[];
  keywords: string[];
  descriptions: string[];
  linkedMessages: MessageRef[];
};

export type EventSortOption = "alphabet" | "date" | "messages";
export type ThemeSortOption = "alphabet" | "messages";
export type SortDirection = "asc" | "desc";

export type StreamPayload = {
  chatId?: string;
  title?: string;
  layer?: string;
  count?: number;
  resumedFromReview?: boolean;
  conversationId?: string;
  conversationHash?: string;
  existingTitle?: string;
  error?: string;
  analysis?: ConversationAnalysis;
  messages?: ParsedMessage[];
  people?: PersonSummary[];
  events?: EventSummary[];
  themes?: ThemeSummary[];
  draftChats?: { id: string; conversationId: string; }[];
  conflicts?: Array<{
    incomingName: string;
    existingName: string;
  }>;
  reviewPeople?: PeopleReviewPerson[];
};

export type StreamEvent = {
  event: string;
  data: StreamPayload;
};

export type StreamHistoryItem = {
  id: string;
  timestamp: number;
  title: string;
  chatId?: string;
  layer?: string;
  detail: string;
};
