import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UnifiedPerson } from "@/lib/types";
import { normalize } from "@/lib/utils";
import { ContentTab } from "./ContentTab";

export function PeopleTab({ people }: { people: UnifiedPerson[] }) {
  const [peopleCollapsed, setPeopleCollapsed] = useState(true);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  const filteredPeople = useMemo(() => {
    const query = normalize(peopleSearchQuery);

    return people
      .map((person) => {
        const matchedMessages =
          query.length > 0
            ? person.linkedMessages.filter(
                (msg) =>
                  normalize(msg.speaker).includes(query) ||
                  normalize(msg.text).includes(query),
              )
            : [];

        return { person, matchedMessages };
      })
      .filter(({ person, matchedMessages }) => {
        if (query.length === 0) return true;
        if (normalize(person.name).includes(query)) return true;
        if (person.aliases.some((alias) => normalize(alias).includes(query))) {
          return true;
        }
        return matchedMessages.length > 0;
      });
  }, [people, peopleSearchQuery]);

  return (
    <ContentTab
      title="People"
      count={people.length}
      collapsed={peopleCollapsed}
      onToggleCollapse={() => setPeopleCollapsed((current) => !current)}
      headerControls={
        <div className="w-full max-w-sm">
          <input
            type="text"
            value={peopleSearchQuery}
            onChange={(event) => setPeopleSearchQuery(event.target.value)}
            placeholder="Grep people/messages (name or text)"
            aria-label="Search people and linked messages"
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      }
      hasItems={people.length > 0}
      items={filteredPeople}
      emptyMessage="People appear after analysis starts."
      searchEmptyMessage="No people or linked messages matched your search."
      renderItem={({ person, matchedMessages }) => (
        <div
          key={person.name}
          className="animate-in fade-in-50 duration-200 space-y-2"
        >
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
            <Badge variant="secondary">
              {person.linkedMessages.length} linked
            </Badge>
            {peopleSearchQuery.trim().length > 0 && (
              <Badge variant="outline">
                {matchedMessages.length} grep matches
              </Badge>
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
            Related events:{" "}
            {person.relatedEvents
              .map((event) => `${event.title} (${event.chat})`)
              .join(" | ") || "None"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Related themes:{" "}
            {person.relatedThemes
              .map((theme) => `${theme.name} (${theme.chat})`)
              .join(" | ") || "None"}
          </p>
          {openPerson === person.name && (
            <div className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Linked messages
              </p>
              <div className="space-y-2">
                {(peopleSearchQuery.trim().length > 0
                  ? matchedMessages
                  : person.linkedMessages
                )
                  .slice(0, 80)
                  .map((message) => (
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
