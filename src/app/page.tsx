"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, LoaderCircle, Monitor, Moon, Sparkles, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PeopleReviewModal,
  PeopleReviewPerson,
} from "@/components/people-review-modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ConversationAnalysis,
  EventSummary,
  ParsedMessage,
  PersonSummary,
  ThemeSummary,
} from "@/lib/types";
import { sha256Hex } from "@/lib/hash";

type ChatStatus = "queued" | "analyzing" | "done" | "error" | "duplicate";

type MessageRef = {
  id: string;
  chat: string;
  line: number;
  speaker: string;
  timestamp: string | undefined;
  text: string;
};

type SessionChat = {
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

type LibraryConversation = {
  _id: string;
  title: string;
  conversationHash?: string;
  createdAt: number;
  analyzedAt?: number;
};

type UnifiedPerson = {
  name: string;
  aliases: string[];
  chats: string[];
  messageCount: number;
  relatedEvents: Array<{ title: string; chat: string }>;
  relatedThemes: Array<{ name: string; chat: string }>;
  linkedMessages: MessageRef[];
};

type UnifiedEvent = {
  title: string;
  chats: string[];
  participants: string[];
  topics: string[];
  descriptions: string[];
  linkedMessages: MessageRef[];
};

type UnifiedTheme = {
  name: string;
  chats: string[];
  eventTitles: string[];
  keywords: string[];
  descriptions: string[];
  linkedMessages: MessageRef[];
};

type EventSortOption = "alphabet" | "date" | "messages";
type ThemeSortOption = "alphabet" | "messages";
type SortDirection = "asc" | "desc";

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function parseChatTimestamp(timestamp: string | undefined): number | null {
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

function firstName(value: string): string {
  return value
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() || "";
}

function inferAddressee(message: MessageRef, participants: string[]): string {
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

function isDirectResponseToNext(message: MessageRef, next: MessageRef | undefined): boolean {
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

function isConversationBreak(message: MessageRef, next: MessageRef | undefined): boolean {
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

const EVENT_LINK_STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "from",
  "this",
  "your",
  "have",
  "been",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "would",
  "could",
  "should",
  "about",
  "there",
  "their",
  "them",
  "they",
  "just",
  "very",
  "more",
  "some",
]);

function eventSignalTokens(event: { title: string; description: string; topics: string[] }): string[] {
  const raw = `${event.title} ${event.description} ${event.topics.join(" ")}`.toLowerCase();
  const words = raw
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !EVENT_LINK_STOP_WORDS.has(word));

  return Array.from(new Set(words));
}

function prettyStatus(status: ChatStatus): string {
  if (status === "queued") return "Queued";
  if (status === "analyzing") return "Analyzing";
  if (status === "done") return "Done";
  if (status === "duplicate") return "Uploaded Previously";
  return "Error";
}

function statusVariant(status: ChatStatus): "secondary" | "outline" | "destructive" {
  if (status === "done" || status === "duplicate") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

function emptyAnalysis(messages: ParsedMessage[] = []): ConversationAnalysis {
  return {
    messages,
    people: [],
    events: [],
    themes: [],
  };
}

type StreamPayload = {
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
  conflicts?: Array<{
    incomingName: string;
    existingName: string;
  }>;
  reviewPeople?: PeopleReviewPerson[];
};

type StreamEvent = {
  event: string;
  data: StreamPayload;
};

type StreamHistoryItem = {
  id: string;
  timestamp: number;
  title: string;
  chatId?: string;
  layer?: string;
  detail: string;
};

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [sessionChats, setSessionChats] = useState<SessionChat[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeChatLabel, setActiveChatLabel] = useState<string>("");
  const [activeLayerLabel, setActiveLayerLabel] = useState<string>("");
  const [streamHistory, setStreamHistory] = useState<StreamHistoryItem[]>([]);
  const [libraryConversations, setLibraryConversations] = useState<LibraryConversation[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isLoadingConversationId, setIsLoadingConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [peopleCollapsed, setPeopleCollapsed] = useState(true);
  const [eventsCollapsed, setEventsCollapsed] = useState(true);
  const [themesCollapsed, setThemesCollapsed] = useState(true);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const [eventSort, setEventSort] = useState<EventSortOption>("alphabet");
  const [eventSortDirection, setEventSortDirection] = useState<SortDirection>("asc");
  const [themeSort, setThemeSort] = useState<ThemeSortOption>("alphabet");
  const [themeSortDirection, setThemeSortDirection] = useState<SortDirection>("asc");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [peopleReviewModalOpen, setPeopleReviewModalOpen] = useState(false);
  const [peopleReviewChatTitle, setPeopleReviewChatTitle] = useState<string>("");
  const [peopleReviewChatId, setPeopleReviewChatId] = useState<string>("");
  const [peopleReviewPeople, setPeopleReviewPeople] = useState<PeopleReviewPerson[]>([]);
  const [peopleReviewFieldDecisions, setPeopleReviewFieldDecisions] = useState<
    Record<
      string,
      {
        fullName: boolean;
        firstName: boolean;
        lastNames: boolean;
        aliases: boolean;
      }
    >
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptedPeopleReviewRef = useRef<Set<string>>(new Set());

  const refreshLibraryConversations = async () => {
    setIsLibraryLoading(true);
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load conversation library.");
      }

      const payload = await response.json();
      const items = Array.isArray(payload?.conversations) ? payload.conversations : [];
      setLibraryConversations(items as LibraryConversation[]);
    } catch {
      // Keep UI functional even if library fetch fails temporarily.
    } finally {
      setIsLibraryLoading(false);
    }
  };

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    void refreshLibraryConversations();
  }, []);

  const currentTheme = hasMounted ? theme ?? "system" : "system";

  const cycleTheme = () => {
    if (currentTheme === "system") {
      setTheme("light");
      return;
    }
    if (currentTheme === "light") {
      setTheme("dark");
      return;
    }
    setTheme("system");
  };

  const pushStreamHistory = (streamEvent: StreamEvent) => {
    const { event, data } = streamEvent;

    let title = "Update";
    let detail = "Pipeline updated.";

    if (event === "chat_started") {
      title = "Chat Started";
      detail = `Started ${data.title || data.chatId || "chat"}.`;
    }
    if (event === "layer_started") {
      title = "Layer Started";
      detail = `Running ${data.layer || "unknown"} layer.`;
    }
    if (event === "layer_done") {
      title = "Layer Complete";
      detail = `Finished ${data.layer || "unknown"} layer (${data.count ?? 0}).`;
    }
    if (event === "people_delta") {
      title = "People Updated";
      detail = `${data.people?.length ?? 0} people loaded.`;
    }
    if (event === "events_delta") {
      title = "Events Updated";
      detail = `${data.events?.length ?? 0} events loaded.`;
    }
    if (event === "themes_delta") {
      title = "Themes Updated";
      detail = `${data.themes?.length ?? 0} themes loaded.`;
    }
    if (event === "chat_done") {
      title = "Chat Complete";
      detail = `${data.title || data.chatId || "Chat"} finished.`;
    }
    if (event === "chat_error") {
      title = "Chat Error";
      detail = data.error || "Unexpected error.";
    }
    if (event === "chat_duplicate") {
      title = "Duplicate Skipped";
      detail = data.error || "Already analyzed.";
    }
    if (event === "session_started") {
      title = data.resumedFromReview ? "Resume Started" : "Session Started";
      detail = data.resumedFromReview
        ? "Continuing analysis after people review."
        : "Analysis session started.";
    }
    if (event === "session_done") {
      title = data.resumedFromReview ? "Resume Complete" : "Session Complete";
      detail = data.resumedFromReview
        ? "Review continuation finished."
        : "All chats finished.";
    }
    if (event === "session_error") {
      title = "Session Error";
      detail = data.error || "Unexpected error.";
    }
    if (event === "people_review_prompt") {
      title = "Review Needed";
      detail = `Please confirm ${data.reviewPeople?.length ?? 0} people before continuing.`;
    }
    if (event === "chat_paused_review") {
      title = "Paused For Review";
      detail = "Chat paused while waiting for people review.";
    }
    if (event === "session_paused_review") {
      title = "Session Paused";
      detail = "Session paused for people review.";
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setStreamHistory((current) => {
      const next = [
        {
          id,
          timestamp: Date.now(),
          title,
          chatId: data.chatId,
          layer: data.layer,
          detail,
        },
        ...current,
      ];
      return next.slice(0, 250);
    });
  };

  const applyStreamEvent = (streamEvent: StreamEvent) => {
    const { event, data } = streamEvent;
    const chatId = data.chatId;

    pushStreamHistory(streamEvent);

    if (!chatId) {
      if (event === "session_done" || event === "session_error") {
        setActiveChatLabel("");
        setActiveLayerLabel("");
        setIsAnalyzing(false);
      }

      if (event === "session_done") {
        void refreshLibraryConversations();
      }

      if (event === "session_error") {
        setError(data.error || "Streaming session failed.");
      }

      return;
    }

    if (event === "chat_started") {
      setActiveChatLabel(data.title || "");
      setActiveLayerLabel("people");
      setSessionChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                status: "analyzing",
                title: data.title || chat.fileName,
                error: undefined,
                analysis: emptyAnalysis(data.messages ?? []),
              }
            : chat,
        ),
      );
      return;
    }

    if (event === "layer_started") {
      setActiveLayerLabel(data.layer || "");
      return;
    }

    if (event === "people_delta") {
      setSessionChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const analysis = chat.analysis || emptyAnalysis();
          return {
            ...chat,
            analysis: {
              ...analysis,
              people: data.people ?? analysis.people,
            },
          };
        }),
      );
      return;
    }

    if (event === "events_delta") {
      setSessionChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const analysis = chat.analysis || emptyAnalysis();
          return {
            ...chat,
            analysis: {
              ...analysis,
              events: data.events ?? analysis.events,
            },
          };
        }),
      );
      return;
    }

    if (event === "themes_delta") {
      setSessionChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const analysis = chat.analysis || emptyAnalysis();
          return {
            ...chat,
            analysis: {
              ...analysis,
              themes: data.themes ?? analysis.themes,
            },
          };
        }),
      );
      return;
    }

    if (event === "people_review_prompt") {
      const people = data.reviewPeople || [];
      const reviewKey = `${chatId}:${people.map((person) => person.fullName).join("|")}`;

      if (promptedPeopleReviewRef.current.has(reviewKey)) {
        return;
      }
      promptedPeopleReviewRef.current.add(reviewKey);

      const initialFieldDecisions: Record<
        string,
        {
          fullName: boolean;
          firstName: boolean;
          lastNames: boolean;
          aliases: boolean;
        }
      > = {};

      for (const person of people) {
        initialFieldDecisions[person.fullName] = {
          fullName: true,
          firstName: true,
          lastNames: true,
          aliases: true,
        };
      }

      setPeopleReviewChatTitle(data.title || "");
      setPeopleReviewChatId(chatId);
      setPeopleReviewPeople(people);
      setPeopleReviewFieldDecisions(initialFieldDecisions);
      setPeopleReviewModalOpen(true);

      return;
    }

    if (event === "chat_paused_review" || event === "session_paused_review") {
      setIsAnalyzing(false);
      setActiveLayerLabel("");
      setActiveChatLabel("");
      return;
    }

    if (event === "chat_done") {
      setSessionChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                status: "done",
                title: data.title || chat.fileName,
                conversationId: data.conversationId || chat.conversationId,
                analysis: data.analysis || chat.analysis || emptyAnalysis(),
              }
            : chat,
        ),
      );
      setActiveChatLabel("");
      setActiveLayerLabel("");
      return;
    }

    if (event === "chat_error") {
      setSessionChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                status: "error",
                error: data.error || "Unexpected error",
              }
            : chat,
        ),
      );
      return;
    }

    if (event === "chat_duplicate") {
      setSessionChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                status: "duplicate",
                title: data.existingTitle || chat.title || chat.fileName,
                conversationId: data.conversationId || chat.conversationId,
                error: data.existingTitle
                  ? `Already analyzed as \"${data.existingTitle}\".`
                  : data.error || "This conversation has already been analyzed.",
              }
            : chat,
        ),
      );
      return;
    }
  };

  const unified = useMemo(() => {
    const analyzed = sessionChats.filter((chat) => Boolean(chat.analysis));
    const completed = sessionChats.filter((chat) => chat.status === "done" && chat.analysis);

    const peopleMap = new Map<
      string,
      {
        name: string;
        aliases: Set<string>;
        chats: Set<string>;
        messageCount: number;
        relatedEvents: Map<string, { title: string; chat: string }>;
        relatedThemes: Map<string, { name: string; chat: string }>;
        linkedMessages: Map<string, MessageRef>;
      }
    >();

    const eventsMap = new Map<
      string,
      {
        title: string;
        chats: Set<string>;
        participants: Set<string>;
        topics: Set<string>;
        descriptions: Set<string>;
        linkedMessages: Map<string, MessageRef>;
      }
    >();

    const themesMap = new Map<
      string,
      {
        name: string;
        chats: Set<string>;
        eventTitles: Set<string>;
        keywords: Set<string>;
        descriptions: Set<string>;
        linkedMessages: Map<string, MessageRef>;
      }
    >();

    const eventMessageRefsByChatAndTitle = new Map<string, MessageRef[]>();

    for (const chat of analyzed) {
      const chatLabel = chat.fileName;
      const analysis = chat.analysis!;
      const events = analysis.events;
      const themes = analysis.themes;
      const indexedMessages = analysis.messages.map((message, index) => ({
        id: `${chat.id}:m${index + 1}`,
        chat: chatLabel,
        line: message.line,
        speaker: message.speaker,
        timestamp: message.timestamp,
        text: message.text,
      }));

      const messagesByLine = new Map(indexedMessages.map((message) => [message.line, message]));

      for (const event of events) {
        const key = normalize(event.title);
        const existing = eventsMap.get(key) || {
          title: event.title,
          chats: new Set<string>(),
          participants: new Set<string>(),
          topics: new Set<string>(),
          descriptions: new Set<string>(),
          linkedMessages: new Map<string, MessageRef>(),
        };

        let linkedMessages = event.evidenceLines
          .map((line) => messagesByLine.get(line))
          .filter((message): message is MessageRef => Boolean(message));

        if (linkedMessages.length === 0) {
          const signalTokens = eventSignalTokens(event);
          linkedMessages = indexedMessages.filter((message) => {
            const text = message.text.toLowerCase();
            return signalTokens.some((token) => text.includes(token));
          });

          if (linkedMessages.length > 12) {
            linkedMessages = linkedMessages.slice(0, 12);
          }
        }

        eventMessageRefsByChatAndTitle.set(
          `${chat.id}::${normalize(event.title)}`,
          linkedMessages,
        );

        existing.chats.add(chatLabel);
        event.participants.forEach((participant) => existing.participants.add(participant));
        event.topics.forEach((topic) => existing.topics.add(topic));
        existing.descriptions.add(event.description);
        linkedMessages.forEach((message) => existing.linkedMessages.set(message.id, message));
        eventsMap.set(key, existing);
      }

      for (const theme of themes) {
        const key = normalize(theme.name);
        const existing = themesMap.get(key) || {
          name: theme.name,
          chats: new Set<string>(),
          eventTitles: new Set<string>(),
          keywords: new Set<string>(),
          descriptions: new Set<string>(),
          linkedMessages: new Map<string, MessageRef>(),
        };

        existing.chats.add(chatLabel);
        theme.eventTitles.forEach((title) => existing.eventTitles.add(title));
        theme.keywords.forEach((keyword) => existing.keywords.add(keyword));
        existing.descriptions.add(theme.description);

        for (const eventTitle of theme.eventTitles) {
          const refs = eventMessageRefsByChatAndTitle.get(`${chat.id}::${normalize(eventTitle)}`) || [];
          refs.forEach((message) => existing.linkedMessages.set(message.id, message));
        }

        if (existing.linkedMessages.size === 0) {
          const keywordTokens = theme.keywords.map(normalize).filter((keyword) => keyword.length > 2);
          indexedMessages
            .filter((message) => keywordTokens.some((token) => message.text.toLowerCase().includes(token)))
            .forEach((message) => existing.linkedMessages.set(message.id, message));
        }

        themesMap.set(key, existing);
      }

      for (const person of analysis.people) {
        const key = normalize(person.name);
        const existing = peopleMap.get(key) || {
          name: person.name,
          aliases: new Set<string>(),
          chats: new Set<string>(),
          messageCount: 0,
          relatedEvents: new Map<string, { title: string; chat: string }>(),
          relatedThemes: new Map<string, { name: string; chat: string }>(),
          linkedMessages: new Map<string, MessageRef>(),
        };

        person.aliases.forEach((alias) => existing.aliases.add(alias));
        existing.chats.add(chatLabel);
        existing.messageCount += person.messageCount;

        const personNames = [person.name, ...person.aliases].map(normalize);
        const relatedEvents = events.filter((event) =>
          event.participants.some((participant) => personNames.includes(normalize(participant))),
        );

        for (const event of relatedEvents) {
          existing.relatedEvents.set(`${chatLabel}::${event.title}`, {
            title: event.title,
            chat: chatLabel,
          });
        }

        const eventTitles = new Set(relatedEvents.map((event) => normalize(event.title)));

        for (const theme of themes) {
          const linked = theme.eventTitles.some((title) => eventTitles.has(normalize(title)));
          if (linked) {
            existing.relatedThemes.set(`${chatLabel}::${theme.name}`, {
              name: theme.name,
              chat: chatLabel,
            });
          }
        }

        indexedMessages
          .filter((message) => {
            const speakerMatch = personNames.includes(normalize(message.speaker));
            const textMatch = personNames.some((name) => name.length > 2 && message.text.toLowerCase().includes(name));
            return speakerMatch || textMatch;
          })
          .forEach((message) => existing.linkedMessages.set(message.id, message));

        peopleMap.set(key, existing);
      }
    }

    const people: UnifiedPerson[] = Array.from(peopleMap.values())
      .map((person) => ({
        name: person.name,
        aliases: Array.from(person.aliases).sort((a, b) => a.localeCompare(b)),
        chats: Array.from(person.chats).sort((a, b) => a.localeCompare(b)),
        messageCount: person.messageCount,
        relatedEvents: Array.from(person.relatedEvents.values()).sort((a, b) =>
          a.title.localeCompare(b.title),
        ),
        relatedThemes: Array.from(person.relatedThemes.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        linkedMessages: Array.from(person.linkedMessages.values()).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const events: UnifiedEvent[] = Array.from(eventsMap.values())
      .map((event) => ({
        title: event.title,
        chats: Array.from(event.chats).sort((a, b) => a.localeCompare(b)),
        participants: Array.from(event.participants).sort((a, b) => a.localeCompare(b)),
        topics: Array.from(event.topics).sort((a, b) => a.localeCompare(b)),
        descriptions: Array.from(event.descriptions),
        linkedMessages: Array.from(event.linkedMessages.values()).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    const themes: UnifiedTheme[] = Array.from(themesMap.values())
      .map((theme) => ({
        name: theme.name,
        chats: Array.from(theme.chats).sort((a, b) => a.localeCompare(b)),
        eventTitles: Array.from(theme.eventTitles).sort((a, b) => a.localeCompare(b)),
        keywords: Array.from(theme.keywords).sort((a, b) => a.localeCompare(b)),
        descriptions: Array.from(theme.descriptions),
        linkedMessages: Array.from(theme.linkedMessages.values()).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const messageTotal = analyzed.reduce(
      (sum, chat) => sum + (chat.analysis?.messages.length ?? 0),
      0,
    );

    return {
      completedCount: completed.length,
      people,
      events,
      themes,
      messageTotal,
    };
  }, [sessionChats]);

  const sortedEvents = useMemo(() => {
    const copy = [...unified.events];
    const direction = eventSortDirection === "asc" ? 1 : -1;

    if (eventSort === "messages") {
      copy.sort(
        (a, b) =>
          (a.linkedMessages.length - b.linkedMessages.length) * direction ||
          a.title.localeCompare(b.title),
      );
      return copy;
    }

    if (eventSort === "date") {
      const latestTimestamp = (event: UnifiedEvent) => {
        let latest = 0;
        for (const message of event.linkedMessages) {
          const value = parseChatTimestamp(message.timestamp) ?? 0;
          if (value > latest) latest = value;
        }
        return latest;
      };

      copy.sort(
        (a, b) => (latestTimestamp(a) - latestTimestamp(b)) * direction || a.title.localeCompare(b.title),
      );
      return copy;
    }

    copy.sort((a, b) => a.title.localeCompare(b.title) * direction);
    return copy;
  }, [unified.events, eventSort, eventSortDirection]);

  const sortedThemes = useMemo(() => {
    const copy = [...unified.themes];
    const direction = themeSortDirection === "asc" ? 1 : -1;

    if (themeSort === "messages") {
      copy.sort(
        (a, b) =>
          (a.linkedMessages.length - b.linkedMessages.length) * direction ||
          a.name.localeCompare(b.name),
      );
      return copy;
    }

    copy.sort((a, b) => a.name.localeCompare(b.name) * direction);
    return copy;
  }, [unified.themes, themeSort, themeSortDirection]);

  const filteredPeople = useMemo(() => {
    const query = normalize(peopleSearchQuery);

    return unified.people
      .map((person) => {
        const matchedMessages =
          query.length === 0
            ? person.linkedMessages
            : person.linkedMessages.filter((message) => {
                const haystack = `${message.speaker} ${message.text} ${message.chat} ${message.timestamp || ""}`
                  .toLowerCase();
                return haystack.includes(query);
              });

        const personMatchesQuery =
          query.length === 0 ||
          person.name.toLowerCase().includes(query) ||
          person.aliases.some((alias) => alias.toLowerCase().includes(query));

        if (!personMatchesQuery && matchedMessages.length === 0) {
          return null;
        }

        return {
          person,
          matchedMessages,
        };
      })
      .filter(
        (entry): entry is { person: UnifiedPerson; matchedMessages: MessageRef[] } => Boolean(entry),
      );
  }, [unified.people, peopleSearchQuery]);

  const rawMessageById = useMemo(() => {
    const map = new Map<string, string>();

    for (const chat of sessionChats) {
      if (!chat.analysis) continue;

      const rawLines = chat.text.replace(/\r/g, "").split("\n");
      const startLines = chat.analysis.messages.map((message) => message.line);

      for (let index = 0; index < chat.analysis.messages.length; index += 1) {
        const message = chat.analysis.messages[index];
        const nextStart = startLines[index + 1] ?? rawLines.length + 1;
        const rawBlock = rawLines.slice(message.line - 1, nextStart - 1).join("\n").trim();
        const messageId = `${chat.id}:m${index + 1}`;

        if (rawBlock) {
          map.set(messageId, rawBlock);
        } else {
          const fallbackTimestamp = message.timestamp ? `${message.timestamp} - ` : "";
          map.set(messageId, `${fallbackTimestamp}${message.speaker}: ${message.text}`);
        }
      }
    }

    return map;
  }, [sessionChats]);

  const participantsByChat = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const chat of sessionChats) {
      const speakers = new Set<string>();

      for (const message of chat.analysis?.messages ?? []) {
        const name = message.speaker.trim();
        if (name) speakers.add(name);
      }

      map.set(chat.fileName, Array.from(speakers));
    }

    return map;
  }, [sessionChats]);

  const toggleSelected = (
    value: string,
    selected: string[],
    setSelected: (values: string[]) => void,
  ) => {
    if (selected.includes(value)) {
      setSelected(selected.filter((item) => item !== value));
      return;
    }

    setSelected([...selected, value]);
  };

  const downloadExport = () => {
    const sectionBlocks: string[] = [];

    const appendSection = (header: string, messages: MessageRef[]) => {
      if (messages.length === 0) return;

      const sorted = [...messages].sort((a, b) => {
        const byChat = a.chat.localeCompare(b.chat);
        if (byChat !== 0) return byChat;
        return a.line - b.line;
      });

      const seen = new Set<string>();
      const byChat = new Map<string, MessageRef[]>();

      for (const message of sorted) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);

        if (!byChat.has(message.chat)) {
          byChat.set(message.chat, []);
        }
        byChat.get(message.chat)!.push(message);
      }

      const chatBlocks: string[] = [];

      for (const [chatName, chatMessages] of byChat) {
        const participants = participantsByChat.get(chatName) || [];
        const lines: string[] = [];

        for (let index = 0; index < chatMessages.length; index += 1) {
          const message = chatMessages[index];
          const next = chatMessages[index + 1];
          const raw = rawMessageById.get(message.id);

          if (!raw) continue;

          lines.push(raw);

          if (!isDirectResponseToNext(message, next)) {
            lines.push(`Addressed to: ${inferAddressee(message, participants)}`);
          }

          if (isConversationBreak(message, next)) {
            lines.push("----------------------------------------");
          }

          if (index < chatMessages.length - 1) {
            lines.push("");
          }
        }

        if (lines.length > 0) {
          chatBlocks.push(`${chatName}\n${lines.join("\n")}`);
        }
      }

      if (chatBlocks.length === 0) return;
      sectionBlocks.push(`${header}\n${chatBlocks.join("\n\n")}`);
    };

    for (const personName of selectedPeople) {
      const person = unified.people.find((item) => item.name === personName);
      if (!person) continue;
      appendSection(`Person: ${person.name}`, person.linkedMessages);
    }

    for (const eventTitle of selectedEvents) {
      const event = unified.events.find((item) => item.title === eventTitle);
      if (!event) continue;
      appendSection(`Event: ${event.title}`, event.linkedMessages);
    }

    for (const themeName of selectedThemes) {
      const theme = unified.themes.find((item) => item.name === themeName);
      if (!theme) continue;
      appendSection(`Theme: ${theme.name}`, theme.linkedMessages);
    }

    if (sectionBlocks.length === 0) {
      setError("Select at least one person, event, or theme with linked messages to export.");
      return;
    }

    const content = sectionBlocks.join("\n\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `convocontext-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setIsExportModalOpen(false);
  };

  const updatePersonFieldDecision = (
    fullName: string,
    field: "fullName" | "firstName" | "lastNames" | "aliases",
    value: boolean,
  ) => {
    setPeopleReviewFieldDecisions((current) => ({
      ...current,
      [fullName]: {
        fullName: current[fullName]?.fullName ?? true,
        firstName: current[fullName]?.firstName ?? true,
        lastNames: current[fullName]?.lastNames ?? true,
        aliases: current[fullName]?.aliases ?? true,
        [field]: value,
      },
    }));
  };

  const savePeopleReview = async () => {
    const chat = sessionChats.find((item) => item.id === peopleReviewChatId);
    if (!chat) {
      setError("Could not resume analysis: chat not found.");
      setPeopleReviewModalOpen(false);
      return;
    }

    // Close immediately so save action always feels responsive.
    setPeopleReviewModalOpen(false);
    setIsAnalyzing(true);
    setActiveChatLabel(chat.title || chat.fileName);
    setActiveLayerLabel("review");

    const reviewedPeople: PersonSummary[] = peopleReviewPeople
      .map((person) => {
        const selection = peopleReviewFieldDecisions[person.fullName] || {
          fullName: true,
          firstName: true,
          lastNames: true,
          aliases: true,
        };

        const selectedName = selection.fullName
          ? person.fullName
          : [
              selection.firstName ? person.firstName : "",
              selection.lastNames ? person.lastNames.join(" ") : "",
            ]
              .join(" ")
              .trim();

        if (!selectedName) {
          return null;
        }

        return {
          name: selectedName,
          aliases: selection.aliases ? person.aliases : [],
          summary: person.summary,
          messageCount: person.messageCount,
        };
      })
      .filter((person): person is PersonSummary => Boolean(person));

    setError(null);

    try {
      const response = await fetch("/api/analyze/review/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          title: chat.title || chat.fileName,
          conversation: chat.text,
          reviewedPeople,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to resume analysis after people review.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const parseSseBlock = (block: string): StreamEvent | null => {
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
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (parsed) {
            applyStreamEvent(parsed);
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const parsed = parseSseBlock(trailing);
        if (parsed) {
          applyStreamEvent(parsed);
        }
      }

      let shouldContinue = false;

      setSessionChats((current) => {
        shouldContinue = current.some((item) => {
          if (item.id === chat.id) return false;
          return item.status === "queued" || item.status === "error";
        });
        return current;
      });

      const detail = `People review saved (${reviewedPeople.length} people)`;

      setStreamHistory((current) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [
          {
            id,
            timestamp: Date.now(),
            title: "Review Saved",
            detail,
          },
          ...current,
        ].slice(0, 250);
      });

      setPeopleReviewChatId("");
      setPeopleReviewPeople([]);
      setPeopleReviewFieldDecisions({});
      setIsAnalyzing(false);
      setActiveChatLabel("");
      setActiveLayerLabel("");

      if (shouldContinue) {
        setTimeout(() => {
          void analyzeSession();
        }, 0);
      } else {
        void refreshLibraryConversations();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to resume analysis after review.");
      setIsAnalyzing(false);
      setActiveChatLabel("");
      setActiveLayerLabel("");
    }
  };

  async function loadConversationFromLibrary(conversationId: string) {
    if (!conversationId) return;

    setIsLoadingConversationId(conversationId);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        cache: "no-store",
      });

      const payload = await response.json();

      if (!response.ok || !payload?.conversation || !payload?.analysis) {
        throw new Error(payload?.error || "Failed to load conversation from library.");
      }

      const conversation = payload.conversation as {
        _id: string;
        title: string;
        rawText: string;
        conversationHash?: string;
      };

      const analysis = payload.analysis as ConversationAnalysis;
      const fallbackHash = await sha256Hex((conversation.rawText || "").trim());
      const conversationHash = conversation.conversationHash || fallbackHash;

      const alreadyLoaded = sessionChats.some(
        (chat) =>
          chat.conversationId === conversation._id || chat.conversationHash === conversationHash,
      );

      if (alreadyLoaded) {
        setError("This analyzed conversation is already in the current session.");
        return;
      }

      setSessionChats((current) => [
        ...current,
        {
          id: `library::${conversation._id}`,
          fileName: conversation.title,
          text: conversation.rawText,
          conversationHash,
          conversationId: conversation._id,
          title: conversation.title,
          status: "done",
          analysis,
        },
      ]);

      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load conversation from library.");
    } finally {
      setIsLoadingConversationId(null);
    }
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const incoming: SessionChat[] = [];
    const allHashes: string[] = [];

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".txt")) continue;

      const text = await file.text();
      const id = `${file.name}::${file.lastModified}::${file.size}`;
      const conversationHash = await sha256Hex(text.trim());

      allHashes.push(conversationHash);

      incoming.push({
        id,
        fileName: file.name,
        text,
        conversationHash,
        status: "queued",
      });
    }

    if (incoming.length === 0) {
      setError("No valid .txt files were selected.");
      return;
    }

    let existingByHash = new Set<string>();
    let existingByHashInfo = new Map<string, { conversationId?: string; title?: string }>();

    try {
      const response = await fetch("/api/conversations/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: allHashes }),
      });

      if (response.ok) {
        const payload = await response.json();
        const existing = Array.isArray(payload?.existing) ? payload.existing : [];
        existingByHash = new Set(
          existing
            .map((item: { hash?: string }) => String(item.hash ?? ""))
            .filter((hash: string) => hash.length > 0),
        );

        const hashEntries: Array<[string, { conversationId?: string; title?: string }]> =
          existing
            .map((item: { hash?: string; conversationId?: string; title?: string }) => {
              const hash = String(item.hash ?? "");
              return [
                hash,
                {
                  conversationId: item.conversationId,
                  title: item.title,
                },
              ];
            })
            .filter((entry: [string, { conversationId?: string; title?: string }]) => entry[0].length > 0);

        existingByHashInfo = new Map(hashEntries);
      }
    } catch {
      // Allow local queueing even if dedupe check endpoint is temporarily unavailable.
    }

    setSessionChats((current) => {
      const existingIds = new Set(current.map((chat) => chat.id));
      const existingHashes = new Set(current.map((chat) => chat.conversationHash));

      const nextEntries: SessionChat[] = [];

      for (const chat of incoming) {
        const duplicateInSession = existingIds.has(chat.id) || existingHashes.has(chat.conversationHash);
        const duplicateInDatabase = existingByHash.has(chat.conversationHash);

        if (!duplicateInSession && !duplicateInDatabase) {
          nextEntries.push(chat);
          existingIds.add(chat.id);
          existingHashes.add(chat.conversationHash);
          continue;
        }

        const existingInfo = existingByHashInfo.get(chat.conversationHash);

        nextEntries.push({
          ...chat,
          conversationId: existingInfo?.conversationId,
          status: "duplicate",
          error: existingInfo?.title
            ? `Already analyzed as \"${existingInfo.title}\".`
            : "This conversation has already been analyzed.",
        });
        existingIds.add(chat.id);
        existingHashes.add(chat.conversationHash);
      }

      return [...current, ...nextEntries];
    });

    setError(null);
  }

  async function analyzeSession() {
    const queue = sessionChats.filter((chat) => chat.status === "queued" || chat.status === "error");

    if (queue.length === 0) {
      setError("Add one or more .txt chats before starting analysis.");
      return;
    }

    setError(null);
    setIsAnalyzing(true);
    setStreamHistory([]);
    promptedPeopleReviewRef.current.clear();
    setPeopleReviewModalOpen(false);
    setPeopleReviewChatId("");
    setPeopleReviewPeople([]);
    setPeopleReviewFieldDecisions({});

    setSessionChats((current) =>
      current.map((chat) =>
        queue.some((queued) => queued.id === chat.id)
          ? { ...chat, status: "queued", error: undefined, analysis: undefined }
          : chat,
      ),
    );

    try {
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chats: queue.map((chat) => ({
            id: chat.id,
            title: chat.fileName,
            conversation: chat.text,
          })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start streaming analysis.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const parseSseBlock = (block: string): StreamEvent | null => {
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
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (parsed) {
            applyStreamEvent(parsed);
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const parsed = parseSseBlock(trailing);
        if (parsed) {
          applyStreamEvent(parsed);
        }
      }

      setActiveChatLabel("");
      setActiveLayerLabel("");
      setIsAnalyzing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected streaming error.");
      setSessionChats((current) =>
        current.map((item) =>
          item.status === "analyzing"
            ? {
                ...item,
                status: "error",
                error: caught instanceof Error ? caught.message : "Unexpected streaming error",
              }
            : item,
        ),
      );
      setActiveChatLabel("");
      setActiveLayerLabel("");
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="relative h-screen overflow-hidden bg-slate-100 dark:bg-slate-950">
      <main className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-4 py-4">
        <div className="mb-3 flex shrink-0 items-center gap-2 text-slate-700 dark:text-slate-200">
          <Sparkles className="size-4" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em]">ConvoContext</p>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[320px_1fr_320px]">
          <aside className="flex min-h-0 flex-col gap-6">
            <Card className="border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 shadow-xl shadow-slate-300/30 dark:shadow-slate-900/40">
              <CardHeader className="space-y-2">
                <CardTitle className="text-2xl">Session Intake</CardTitle>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Upload one or more WhatsApp `.txt` exports for shared context analysis.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!isAnalyzing) setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    if (!isAnalyzing) {
                      void addFiles(event.dataTransfer.files);
                    }
                  }}
                  className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                    isDragging ? "border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800" : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  }`}
                >
                  <FileUp className="mx-auto mb-3 size-7 text-slate-700 dark:text-slate-200" />
                  <p className="font-medium">Drag and drop chat `.txt` files</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Multiple files supported.</p>
                  <Button
                    className="mt-4"
                    variant="outline"
                    disabled={isAnalyzing}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Select Files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Select WhatsApp chat text files"
                    accept=".txt,text/plain"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      void addFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button disabled={isAnalyzing} onClick={() => void analyzeSession()}>
                    {isAnalyzing ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Analyzing
                      </>
                    ) : (
                      "Analyze Session"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isAnalyzing || sessionChats.length === 0}
                    onClick={() => {
                      setSessionChats([]);
                      setError(null);
                      setStreamHistory([]);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Clear Session
                  </Button>
                </div>

                {isAnalyzing && (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Running analysis...{" "}
                    {activeChatLabel
                      ? `Current: ${activeChatLabel}${activeLayerLabel ? ` (${activeLayerLabel})` : ""}`
                      : "Preparing next chat"}
                  </p>
                )}

                {error && (
                  <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="flex min-h-0 flex-1 flex-col border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
              <CardHeader className="space-y-2">
                <CardTitle>Uploaded Chats</CardTitle>
                <p className="text-sm text-slate-600 dark:text-slate-300">Each chat keeps source attribution.</p>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1">
                <ScrollArea className="h-full w-full pr-3">
                  <div className="space-y-3">
                    {sessionChats.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-300">No chats uploaded yet.</p>
                    )}

                    {sessionChats.map((chat) => (
                      <div key={chat.id} className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{chat.fileName}</p>
                          <Badge variant={statusVariant(chat.status)}>{prettyStatus(chat.status)}</Badge>
                        </div>

                        {chat.analysis && (
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{chat.analysis.messages.length} messages</Badge>
                            <Badge variant="outline">{chat.analysis.people.length} people</Badge>
                            <Badge variant="outline">{chat.analysis.events.length} events</Badge>
                            <Badge variant="outline">{chat.analysis.themes.length} themes</Badge>
                          </div>
                        )}

                        {chat.error && (
                          <p
                            className={`mt-2 text-xs ${
                              chat.status === "duplicate"
                                ? "text-slate-600 dark:text-slate-300"
                                : "text-red-600"
                            }`}
                          >
                            {chat.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
              <CardHeader className="space-y-2">
                <CardTitle>Conversation Library</CardTitle>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Load previously analyzed chats without re-uploading.
                </p>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[220px] w-full pr-3">
                  <div className="space-y-3">
                    {isLibraryLoading && (
                      <p className="text-sm text-slate-600 dark:text-slate-300">Loading conversation library...</p>
                    )}

                    {!isLibraryLoading && libraryConversations.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-300">No analyzed conversations found.</p>
                    )}

                    {libraryConversations.map((conversation) => (
                      <div
                        key={conversation._id}
                        className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 p-3"
                      >
                        <p className="text-sm font-semibold">{conversation.title}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {new Date(conversation.analyzedAt || conversation.createdAt).toLocaleString()}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          disabled={isLoadingConversationId === conversation._id}
                          onClick={() => void loadConversationFromLibrary(conversation._id)}
                        >
                          {isLoadingConversationId === conversation._id ? (
                            <>
                              <LoaderCircle className="size-4 animate-spin" />
                              Loading
                            </>
                          ) : (
                            "Load"
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <div className="mt-auto">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={cycleTheme}
                aria-label="Change theme"
              >
                {currentTheme === "dark" ? (
                  <Moon className="size-4" />
                ) : currentTheme === "light" ? (
                  <Sun className="size-4" />
                ) : (
                  <Monitor className="size-4" />
                )}
                Theme: {currentTheme}
              </Button>
            </div>
          </aside>

          <section className="min-h-0 space-y-6 overflow-y-auto pr-1">
            <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
              <CardHeader>
                <CardTitle>Unified Session Dashboard</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{unified.completedCount} chats analyzed</Badge>
                  <Badge variant="secondary">{unified.messageTotal} total messages</Badge>
                  <Badge variant="secondary">{unified.people.length} unified people</Badge>
                  <Badge variant="secondary">{unified.events.length} unified events</Badge>
                  <Badge variant="secondary">{unified.themes.length} unified themes</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
                <CardHeader
                  className="flex cursor-pointer flex-row items-center justify-between gap-3 select-none"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPeopleCollapsed((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setPeopleCollapsed((current) => !current);
                    }
                  }}
                >
                  <CardTitle>People ({unified.people.length})</CardTitle>
                  <div className="w-full max-w-sm" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="text"
                      value={peopleSearchQuery}
                      onChange={(event) => setPeopleSearchQuery(event.target.value)}
                      placeholder="Grep people/messages (name or text)"
                      aria-label="Search people and linked messages"
                      className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </CardHeader>
                {!peopleCollapsed && <CardContent className="animate-in fade-in-50 duration-300">
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {filteredPeople.map(({ person, matchedMessages }) => (
                        <div key={person.name} className="animate-in fade-in-50 duration-200 space-y-2">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left"
                            onClick={() =>
                              setOpenPerson((current) =>
                                current === person.name ? null : person.name,
                              )
                            }
                          >
                            <p className="font-semibold">{person.name}</p>
                            <Badge variant="outline">{person.messageCount} messages</Badge>
                            <Badge variant="secondary">{person.linkedMessages.length} linked</Badge>
                            {peopleSearchQuery.trim().length > 0 && (
                              <Badge variant="outline">{matchedMessages.length} grep matches</Badge>
                            )}
                          </button>
                          {person.aliases.length > 0 && (
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              Aliases: {person.aliases.join(", ")}
                            </p>
                          )}
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Chats: {person.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Related events: {person.relatedEvents.map((event) => `${event.title} (${event.chat})`).join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Related themes: {person.relatedThemes.map((theme) => `${theme.name} (${theme.chat})`).join(" | ") || "None"}
                          </p>
                          {openPerson === person.name && (
                            <div className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Linked messages</p>
                              <div className="space-y-2">
                                {(peopleSearchQuery.trim().length > 0
                                  ? matchedMessages
                                  : person.linkedMessages)
                                  .slice(0, 80)
                                  .map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-600 dark:text-slate-300">
                                      {message.id} | {message.chat} | line {message.line}
                                    </p>
                                    <p>
                                      <span className="font-semibold">{message.speaker}</span>
                                      {message.timestamp ? ` (${message.timestamp})` : ""}: {message.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <Separator />
                        </div>
                      ))}

                      {unified.people.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-300">People appear after analysis starts.</p>
                      )}

                      {unified.people.length > 0 && filteredPeople.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          No people or linked messages matched your search.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>}
              </Card>

              <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
                <CardHeader
                  className="flex cursor-pointer flex-row items-center justify-between gap-3 select-none"
                  role="button"
                  tabIndex={0}
                  onClick={() => setEventsCollapsed((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEventsCollapsed((current) => !current);
                    }
                  }}
                >
                  <CardTitle>Events ({unified.events.length})</CardTitle>
                  <div
                    className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <label className="flex items-center gap-2">
                      Sort
                      <select
                        className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                        value={eventSort}
                        onChange={(event) => setEventSort(event.target.value as EventSortOption)}
                      >
                        <option value="alphabet">Alphabet</option>
                        <option value="date">Date</option>
                        <option value="messages">Message amount</option>
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEventSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                      }
                    >
                      {eventSortDirection === "asc" ? "Asc" : "Desc"}
                    </Button>
                  </div>
                </CardHeader>
                {!eventsCollapsed && <CardContent className="animate-in fade-in-50 duration-300">
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {sortedEvents.map((event) => (
                        <div key={event.title} className="animate-in fade-in-50 duration-200 space-y-2">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left"
                            onClick={() => setOpenEvent((current) => (current === event.title ? null : event.title))}
                          >
                            <p className="font-semibold">{event.title}</p>
                            <Badge variant="secondary">{event.linkedMessages.length} linked</Badge>
                          </button>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Chats: {event.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Participants: {event.participants.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Topics: {event.topics.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Detail: {event.descriptions[0] || "None"}
                          </p>
                          {openEvent === event.title && (
                            <div className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Linked messages</p>
                              <div className="space-y-2">
                                {event.linkedMessages.slice(0, 40).map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-600 dark:text-slate-300">
                                      {message.id} | {message.chat} | line {message.line}
                                    </p>
                                    <p>
                                      <span className="font-semibold">{message.speaker}</span>
                                      {message.timestamp ? ` (${message.timestamp})` : ""}: {message.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <Separator />
                        </div>
                      ))}

                      {unified.events.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-300">Events appear after analysis starts.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>}
              </Card>

              <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
                <CardHeader
                  className="flex cursor-pointer flex-row items-center justify-between gap-3 select-none"
                  role="button"
                  tabIndex={0}
                  onClick={() => setThemesCollapsed((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setThemesCollapsed((current) => !current);
                    }
                  }}
                >
                  <CardTitle>Themes ({unified.themes.length})</CardTitle>
                  <div
                    className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <label className="flex items-center gap-2">
                      Sort
                      <select
                        className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                        value={themeSort}
                        onChange={(event) => setThemeSort(event.target.value as ThemeSortOption)}
                      >
                        <option value="alphabet">Alphabet</option>
                        <option value="messages">Message amount</option>
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setThemeSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                      }
                    >
                      {themeSortDirection === "asc" ? "Asc" : "Desc"}
                    </Button>
                  </div>
                </CardHeader>
                {!themesCollapsed && <CardContent className="animate-in fade-in-50 duration-300">
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {sortedThemes.map((theme) => (
                        <div key={theme.name} className="animate-in fade-in-50 duration-200 space-y-2">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left"
                            onClick={() => setOpenTheme((current) => (current === theme.name ? null : theme.name))}
                          >
                            <p className="font-semibold">{theme.name}</p>
                            <Badge variant="secondary">{theme.linkedMessages.length} linked</Badge>
                          </button>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Chats: {theme.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Keywords: {theme.keywords.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Linked events: {theme.eventTitles.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Detail: {theme.descriptions[0] || "None"}
                          </p>
                          {openTheme === theme.name && (
                            <div className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Linked messages</p>
                              <div className="space-y-2">
                                {theme.linkedMessages.slice(0, 40).map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-600 dark:text-slate-300">
                                      {message.id} | {message.chat} | line {message.line}
                                    </p>
                                    <p>
                                      <span className="font-semibold">{message.speaker}</span>
                                      {message.timestamp ? ` (${message.timestamp})` : ""}: {message.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <Separator />
                        </div>
                      ))}

                      {unified.themes.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-300">Themes appear after analysis starts.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>}
              </Card>
            </div>
          </section>

          <aside className="min-h-0 space-y-3">
            <Button type="button" className="w-full" onClick={() => setIsExportModalOpen(true)}>
              Export Selected Messages
            </Button>
            <Card className="flex h-full min-h-0 flex-col border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
              <CardHeader className="space-y-2">
                <CardTitle>Stream History</CardTitle>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Live stream events from the analysis pipeline.
                </p>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={streamHistory.length === 0}
                  onClick={() => setStreamHistory([])}
                >
                  Clear Stream History
                </Button>
                <ScrollArea className="h-full w-full pr-3">
                  <div className="space-y-2">
                    {streamHistory.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-300">No stream events yet.</p>
                    )}

                    {streamHistory.map((item) => (
                      <div key={item.id} className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
                        <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </p>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{item.detail}</p>
                        {(item.chatId || item.layer) && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {[item.chatId ? "Chat update" : null, item.layer ? `Now in ${item.layer} layer` : null]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>

      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm px-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3 dark:border-slate-700">
              <h2 className="text-base font-semibold">Export Messages</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsExportModalOpen(false)}>
                Close
              </Button>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold">People</p>
                <ScrollArea className="h-[300px] rounded-md border border-slate-300 p-2 dark:border-slate-700">
                  <div className="space-y-2">
                    {unified.people.map((person) => (
                      <label key={person.name} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Select person ${person.name}`}
                          checked={selectedPeople.includes(person.name)}
                          onChange={() =>
                            toggleSelected(person.name, selectedPeople, setSelectedPeople)
                          }
                        />
                        <span>{person.name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Events</p>
                <ScrollArea className="h-[300px] rounded-md border border-slate-300 p-2 dark:border-slate-700">
                  <div className="space-y-2">
                    {sortedEvents.map((event) => (
                      <label key={event.title} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Select event ${event.title}`}
                          checked={selectedEvents.includes(event.title)}
                          onChange={() =>
                            toggleSelected(event.title, selectedEvents, setSelectedEvents)
                          }
                        />
                        <span>{event.title}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Themes</p>
                <ScrollArea className="h-[300px] rounded-md border border-slate-300 p-2 dark:border-slate-700">
                  <div className="space-y-2">
                    {sortedThemes.map((theme) => (
                      <label key={theme.name} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Select theme ${theme.name}`}
                          checked={selectedThemes.includes(theme.name)}
                          onChange={() =>
                            toggleSelected(theme.name, selectedThemes, setSelectedThemes)
                          }
                        />
                        <span>{theme.name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-300 px-4 py-3 dark:border-slate-700">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Selected: {selectedPeople.length + selectedEvents.length + selectedThemes.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedPeople([]);
                    setSelectedEvents([]);
                    setSelectedThemes([]);
                  }}
                >
                  Clear
                </Button>
                <Button type="button" onClick={downloadExport}>
                  Download .txt
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PeopleReviewModal
        isOpen={peopleReviewModalOpen}
        chatTitle={peopleReviewChatTitle}
        people={peopleReviewPeople}
        personFieldDecisions={peopleReviewFieldDecisions}
        onPersonFieldToggle={updatePersonFieldDecision}
        onClose={() => {
          setPeopleReviewModalOpen(false);
          setPeopleReviewFieldDecisions({});
        }}
        onConfirm={savePeopleReview}
      />
    </div>
  );
}
