import { Dispatch, SetStateAction, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UnifiedPerson, UnifiedEvent, UnifiedTheme, SessionChat, MessageRef } from "@/lib/types";
import { isDirectResponseToNext, inferAddressee, isConversationBreak } from "@/lib/utils";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  unified: {
    people: UnifiedPerson[];
    events: UnifiedEvent[];
    themes: UnifiedTheme[];
  };
  sessionChats: SessionChat[];
  setError: (err: string | null) => void;
}

export function ExportModal({
  isOpen,
  onClose,
  unified,
  sessionChats,
  setError
}: ExportModalProps) {
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);

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

  const rawMessageById = useMemo(() => {
    const map = new Map<string, string>();

    for (const chat of sessionChats) {
      if (!chat.analysis) continue;

      const rawLines = chat.text.replace(/\r/g, "").split("\n");
      const startLines = chat.analysis.messages.map((message) => message.line);

      for (let index = 0; index < chat.analysis.messages.length; index += 1) {
        const message = chat.analysis.messages[index];
        const nextStart = startLines[index + 1] ?? rawLines.length + 1;
        const rawBlock = rawLines
          .slice(message.line - 1, nextStart - 1)
          .join("\n")
          .trim();
        const messageId = `${chat.id}:m${index + 1}`;

        if (rawBlock) {
          map.set(messageId, rawBlock);
        } else {
          const fallbackTimestamp = message.timestamp
            ? `${message.timestamp} - `
            : "";
          map.set(
            messageId,
            `${fallbackTimestamp}${message.speaker}: ${message.text}`,
          );
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
            lines.push(
              `Addressed to: ${inferAddressee(message, participants)}`,
            );
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
      setError(
        "Select at least one person, event, or theme with linked messages to export.",
      );
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

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm px-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3 dark:border-slate-700">
          <h2 className="text-base font-semibold">Export Messages</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-semibold">People</p>
            <ScrollArea className="h-[300px] rounded-md border border-slate-300 p-2 dark:border-slate-700">
              <div className="space-y-2">
                {unified.people.map((person: UnifiedPerson) => (
                  <label
                    key={person.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select person ${person.name}`}
                      checked={selectedPeople.includes(person.name)}
                      onChange={() =>
                        toggleSelected(
                          person.name,
                          selectedPeople,
                          setSelectedPeople,
                        )
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
                {unified.events.map((event: UnifiedEvent) => (
                  <label
                    key={event.title}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select event ${event.title}`}
                      checked={selectedEvents.includes(event.title)}
                      onChange={() =>
                        toggleSelected(
                          event.title,
                          selectedEvents,
                          setSelectedEvents,
                        )
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
                {unified.themes.map((theme: UnifiedTheme) => (
                  <label
                    key={theme.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select theme ${theme.name}`}
                      checked={selectedThemes.includes(theme.name)}
                      onChange={() =>
                        toggleSelected(
                          theme.name,
                          selectedThemes,
                          setSelectedThemes,
                        )
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
            Selected:{" "}
            {selectedPeople.length +
              selectedEvents.length +
              selectedThemes.length}
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
  );
}
