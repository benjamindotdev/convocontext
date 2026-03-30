import { useMemo } from "react";
import { MessageRef, SessionChat, UnifiedPerson, UnifiedEvent, UnifiedTheme } from "@/lib/types";
import { normalize, eventSignalTokens } from "@/lib/utils";

export function useUnifiedData(sessionChats: SessionChat[]) {
  return useMemo(() => {
    const analyzed = sessionChats.filter((chat) => Boolean(chat.analysis));
    const completed = sessionChats.filter(
      (chat) => chat.status === "done" && chat.analysis,
    );

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

      const messagesByLine = new Map(
        indexedMessages.map((message) => [message.line, message]),
      );

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
        event.participants.forEach((participant) =>
          existing.participants.add(participant),
        );
        event.topics.forEach((topic) => existing.topics.add(topic));
        existing.descriptions.add(event.description);
        linkedMessages.forEach((message) =>
          existing.linkedMessages.set(message.id, message),
        );
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
          const refs =
            eventMessageRefsByChatAndTitle.get(
              `${chat.id}::${normalize(eventTitle)}`,
            ) || [];
          refs.forEach((message) =>
            existing.linkedMessages.set(message.id, message),
          );
        }

        if (existing.linkedMessages.size === 0) {
          const keywordTokens = theme.keywords
            .map(normalize)
            .filter((keyword) => keyword.length > 2);
          indexedMessages
            .filter((message) =>
              keywordTokens.some((token) =>
                message.text.toLowerCase().includes(token),
              ),
            )
            .forEach((message) =>
              existing.linkedMessages.set(message.id, message),
            );
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
          event.participants.some((participant) =>
            personNames.includes(normalize(participant)),
          ),
        );

        for (const event of relatedEvents) {
          existing.relatedEvents.set(`${chatLabel}::${event.title}`, {
            title: event.title,
            chat: chatLabel,
          });
        }

        const eventTitles = new Set(
          relatedEvents.map((event) => normalize(event.title)),
        );

        for (const theme of themes) {
          const linked = theme.eventTitles.some((title) =>
            eventTitles.has(normalize(title)),
          );
          if (linked) {
            existing.relatedThemes.set(`${chatLabel}::${theme.name}`, {
              name: theme.name,
              chat: chatLabel,
            });
          }
        }

        indexedMessages
          .filter((message) => {
            const speakerMatch = personNames.includes(
              normalize(message.speaker),
            );
            const textMatch = personNames.some(
              (name) =>
                name.length > 2 && message.text.toLowerCase().includes(name),
            );
            return speakerMatch || textMatch;
          })
          .forEach((message) =>
            existing.linkedMessages.set(message.id, message),
          );

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
        linkedMessages: Array.from(person.linkedMessages.values()).sort(
          (a, b) => a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const events: UnifiedEvent[] = Array.from(eventsMap.values())
      .map((event) => ({
        title: event.title,
        chats: Array.from(event.chats).sort((a, b) => a.localeCompare(b)),
        participants: Array.from(event.participants).sort((a, b) =>
          a.localeCompare(b),
        ),
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
        eventTitles: Array.from(theme.eventTitles).sort((a, b) =>
          a.localeCompare(b),
        ),
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
}
