import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UnifiedEvent, EventSortOption, SortDirection } from "@/lib/types";
import { parseChatTimestamp, latestEventTimestamp } from "@/lib/utils";
import { ContentTab } from "./ContentTab";

export function EventsTab({ events }: { events: UnifiedEvent[] }) {
  const [eventsCollapsed, setEventsCollapsed] = useState(true);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [eventSort, setEventSort] = useState<EventSortOption>("alphabet");
  const [eventSortDirection, setEventSortDirection] =
    useState<SortDirection>("asc");

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    if (eventSort === "alphabet") {
      copy.sort((a, b) =>
        eventSortDirection === "asc"
          ? a.title.localeCompare(b.title)
          : b.title.localeCompare(a.title),
      );
      return copy;
    }

    if (eventSort === "date") {
      copy.sort((a, b) => {
        const tA = latestEventTimestamp(a);
        const tB = latestEventTimestamp(b);
        return eventSortDirection === "asc" ? tA - tB : tB - tA;
      });
      return copy;
    }

    if (eventSort === "messages") {
      copy.sort((a, b) =>
        eventSortDirection === "asc"
          ? a.linkedMessages.length - b.linkedMessages.length
          : b.linkedMessages.length - a.linkedMessages.length,
      );
      return copy;
    }

    return copy;
  }, [events, eventSort, eventSortDirection]);

  return (
    <ContentTab
      title="Events"
      count={events.length}
      collapsed={eventsCollapsed}
      onToggleCollapse={() => setEventsCollapsed((current) => !current)}
      headerControls={
        <>
          <label className="flex items-center gap-2">
            Sort
            <select
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              value={eventSort}
              onChange={(event) =>
                setEventSort(event.target.value as EventSortOption)
              }
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
              setEventSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              )
            }
          >
            {eventSortDirection === "asc" ? "Asc" : "Desc"}
          </Button>
        </>
      }
      hasItems={events.length > 0}
      items={sortedEvents}
      emptyMessage="Events appear after analysis starts."
      renderItem={(event) => (
        <div
          key={event.title}
          className="animate-in fade-in-50 duration-200 space-y-2"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() =>
              setOpenEvent((current) =>
                current === event.title ? null : event.title,
              )
            }
          >
            <p className="font-semibold">{event.title}</p>
            <Badge variant="secondary">
              {event.linkedMessages.length} linked
            </Badge>
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
              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Linked messages
              </p>
              <div className="space-y-2">
                {event.linkedMessages.slice(0, 40).map((message) => (
                  <div key={message.id} className="text-xs">
                    <p className="font-mono text-slate-600 dark:text-slate-300">
                      {message.id} | {message.chat} | line {message.line}
                    </p>
                    <p>
                      <span className="font-semibold">{message.speaker}</span>
                      {message.timestamp ? ` (${message.timestamp})` : ""}
                      : {message.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Separator />
        </div>
      )}
    />
  );
}
