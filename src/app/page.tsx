"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, LoaderCircle, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ConversationAnalysis } from "@/lib/types";

type ChatStatus = "queued" | "analyzing" | "done" | "error";

type MessageRef = {
  id: string;
  chat: string;
  line: number;
  speaker: string;
  timestamp?: string;
  text: string;
};

type SessionChat = {
  id: string;
  fileName: string;
  text: string;
  status: ChatStatus;
  title?: string;
  error?: string;
  analysis?: ConversationAnalysis;
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

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function prettyStatus(status: ChatStatus): string {
  if (status === "queued") return "Queued";
  if (status === "analyzing") return "Analyzing";
  if (status === "done") return "Done";
  return "Error";
}

function statusVariant(status: ChatStatus): "secondary" | "outline" | "destructive" {
  if (status === "done") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

export default function Home() {
  const [sessionChats, setSessionChats] = useState<SessionChat[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeChatLabel, setActiveChatLabel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [openTheme, setOpenTheme] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const unified = useMemo(() => {
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

    for (const chat of completed) {
      const chatLabel = chat.fileName;
      const analysis = chat.analysis;
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
          const topicTokens = event.topics.map(normalize).filter((topic) => topic.length > 2);
          const participantTokens = event.participants.map(normalize);
          linkedMessages = indexedMessages.filter((message) => {
            const haystack = `${message.speaker} ${message.text}`.toLowerCase();
            return (
              topicTokens.some((token) => haystack.includes(token)) ||
              participantTokens.some((token) => token && haystack.includes(token))
            );
          });
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

    const messageTotal = completed.reduce(
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

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const incoming: SessionChat[] = [];

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".txt")) continue;

      const text = await file.text();
      const id = `${file.name}::${file.lastModified}::${file.size}`;

      incoming.push({
        id,
        fileName: file.name,
        text,
        status: "queued",
      });
    }

    if (incoming.length === 0) {
      setError("No valid .txt files were selected.");
      return;
    }

    setSessionChats((current) => {
      const existingIds = new Set(current.map((chat) => chat.id));
      const uniqueIncoming = incoming.filter((chat) => !existingIds.has(chat.id));
      return [...current, ...uniqueIncoming];
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

    for (const chat of queue) {
      setActiveChatLabel(chat.fileName);
      setSessionChats((current) =>
        current.map((item) =>
          item.id === chat.id ? { ...item, status: "analyzing", error: undefined } : item,
        ),
      );

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: chat.fileName,
            conversation: chat.text,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to analyze chat");
        }

        setSessionChats((current) =>
          current.map((item) =>
            item.id === chat.id
              ? {
                  ...item,
                  status: "done",
                  title: data.title,
                  analysis: data.analysis,
                }
              : item,
          ),
        );
      } catch (caught) {
        setSessionChats((current) =>
          current.map((item) =>
            item.id === chat.id
              ? {
                  ...item,
                  status: "error",
                  error: caught instanceof Error ? caught.message : "Unexpected error",
                }
              : item,
          ),
        );
      }
    }

    setActiveChatLabel("");
    setIsAnalyzing(false);
  }

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7_0%,_#f9fafb_45%,_#e0f2fe_100%)]">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
        <Card className="border-amber-500/25 bg-white/90 shadow-xl shadow-amber-200/40">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-amber-700">
              <Sparkles className="size-4" />
              <p className="text-xs font-semibold uppercase tracking-[0.2em]">ConvoContext</p>
            </div>
            <CardTitle className="text-2xl">Session Dashboard</CardTitle>
            <p className="text-sm text-muted-foreground">
              Upload one or more WhatsApp `.txt` exports. Analysis runs chat-by-chat, and shared
              context is merged across the session.
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
                isDragging ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"
              }`}
            >
              <FileUp className="mx-auto mb-3 size-7 text-amber-700" />
              <p className="font-medium">Drag and drop chat `.txt` files here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You can upload multiple chats for shared context analysis.
              </p>
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
                }}
              >
                <Trash2 className="size-4" />
                Clear Session
              </Button>
            </div>

            {isAnalyzing && (
              <p className="text-sm text-muted-foreground">
                Running analysis... {activeChatLabel ? `Current: ${activeChatLabel}` : "Preparing next chat"}
              </p>
            )}

            {error && (
              <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="border-slate-300/70 bg-white/90">
            <CardHeader className="space-y-2">
              <CardTitle>Uploaded Chats</CardTitle>
              <p className="text-sm text-muted-foreground">Each chat keeps source attribution.</p>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[620px] pr-3">
                <div className="space-y-3">
                  {sessionChats.length === 0 && (
                    <p className="text-sm text-muted-foreground">No chats uploaded yet.</p>
                  )}

                  {sessionChats.map((chat) => (
                    <div key={chat.id} className="rounded-lg border border-slate-200 p-3">
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

                      {chat.error && <p className="mt-2 text-xs text-red-600">{chat.error}</p>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <section className="space-y-6">
            <Card className="border-slate-300/70 bg-white/90">
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

            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="border-slate-300/70 bg-white/90">
                <CardHeader>
                  <CardTitle>People</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {unified.people.map((person) => (
                        <div key={person.name} className="space-y-2">
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
                            <p className="text-xs text-muted-foreground">
                              Aliases: {person.aliases.join(", ")}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Chats: {person.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Related events: {person.relatedEvents.map((event) => `${event.title} (${event.chat})`).join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Related themes: {person.relatedThemes.map((theme) => `${theme.name} (${theme.chat})`).join(" | ") || "None"}
                          </p>
                          {openPerson === person.name && (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-700">Linked messages</p>
                              <div className="space-y-2">
                                {person.linkedMessages.slice(0, 40).map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-500">
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
                        <p className="text-sm text-muted-foreground">People appear after analysis starts.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="border-slate-300/70 bg-white/90">
                <CardHeader>
                  <CardTitle>Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {unified.events.map((event) => (
                        <div key={event.title} className="space-y-2">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left"
                            onClick={() => setOpenEvent((current) => (current === event.title ? null : event.title))}
                          >
                            <p className="font-semibold">{event.title}</p>
                            <Badge variant="secondary">{event.linkedMessages.length} linked</Badge>
                          </button>
                          <p className="text-xs text-muted-foreground">
                            Chats: {event.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Participants: {event.participants.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Topics: {event.topics.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Detail: {event.descriptions[0] || "None"}
                          </p>
                          {openEvent === event.title && (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-700">Linked messages</p>
                              <div className="space-y-2">
                                {event.linkedMessages.slice(0, 40).map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-500">
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
                        <p className="text-sm text-muted-foreground">Events appear after analysis starts.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="border-slate-300/70 bg-white/90">
                <CardHeader>
                  <CardTitle>Themes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[470px] pr-3">
                    <div className="space-y-4">
                      {unified.themes.map((theme) => (
                        <div key={theme.name} className="space-y-2">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left"
                            onClick={() => setOpenTheme((current) => (current === theme.name ? null : theme.name))}
                          >
                            <p className="font-semibold">{theme.name}</p>
                            <Badge variant="secondary">{theme.linkedMessages.length} linked</Badge>
                          </button>
                          <p className="text-xs text-muted-foreground">
                            Chats: {theme.chats.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Keywords: {theme.keywords.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Linked events: {theme.eventTitles.join(" | ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Detail: {theme.descriptions[0] || "None"}
                          </p>
                          {openTheme === theme.name && (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <p className="mb-2 text-xs font-semibold text-slate-700">Linked messages</p>
                              <div className="space-y-2">
                                {theme.linkedMessages.slice(0, 40).map((message) => (
                                  <div key={message.id} className="text-xs">
                                    <p className="font-mono text-slate-500">
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
                        <p className="text-sm text-muted-foreground">Themes appear after analysis starts.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
