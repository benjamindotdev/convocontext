"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, LoaderCircle, Monitor, Moon, Sparkles, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  conversationId?: string;
  conversationHash?: string;
  existingTitle?: string;
  error?: string;
  analysis?: ConversationAnalysis;
  messages?: ParsedMessage[];
  people?: PersonSummary[];
  events?: EventSummary[];
  themes?: ThemeSummary[];
};

type StreamEvent = {
  event: string;
  data: StreamPayload;
};

type StreamHistoryItem = {
  id: string;
  timestamp: number;
  event: string;
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
  const [eventSort, setEventSort] = useState<EventSortOption>("alphabet");
  const [eventSortDirection, setEventSortDirection] = useState<SortDirection>("asc");
  const [themeSort, setThemeSort] = useState<ThemeSortOption>("alphabet");
  const [themeSortDirection, setThemeSortDirection] = useState<SortDirection>("asc");
  const [hasMounted, setHasMounted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    let detail = event;
    if (event === "chat_started") detail = `Started ${data.title || data.chatId || "chat"}`;
    if (event === "layer_started") detail = `Layer started: ${data.layer || "unknown"}`;
    if (event === "layer_done") detail = `Layer done: ${data.layer || "unknown"} (${data.count ?? 0})`;
    if (event === "people_delta") detail = `People updated (${data.people?.length ?? 0})`;
    if (event === "events_delta") detail = `Events updated (${data.events?.length ?? 0})`;
    if (event === "themes_delta") detail = `Themes updated (${data.themes?.length ?? 0})`;
    if (event === "chat_done") detail = `Completed ${data.title || data.chatId || "chat"}`;
    if (event === "chat_error") detail = `Error: ${data.error || "Unexpected error"}`;
    if (event === "chat_duplicate") detail = `Duplicate skipped: ${data.error || "Already analyzed"}`;
    if (event === "session_started") detail = "Session started";
    if (event === "session_done") detail = "Session completed";
    if (event === "session_error") detail = `Session error: ${data.error || "Unexpected error"}`;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setStreamHistory((current) => {
      const next = [
        {
          id,
          timestamp: Date.now(),
          event,
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
                </CardHeader>
                {!peopleCollapsed && <CardContent className="animate-in fade-in-50 duration-300">
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {unified.people.map((person) => (
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
                                {person.linkedMessages.slice(0, 40).map((message) => (
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

          <aside className="min-h-0">
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
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.event}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{item.detail}</p>
                        {(item.chatId || item.layer) && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {[item.chatId ? `chat ${item.chatId}` : null, item.layer ? `layer ${item.layer}` : null]
                              .filter(Boolean)
                              .join(" | ")}
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
    </div>
  );
}
