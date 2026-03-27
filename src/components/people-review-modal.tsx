import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X } from "lucide-react";

export type PeopleReviewPerson = {
  fullName: string;
  firstName: string;
  lastNames: string[];
  aliases: string[];
  summary: string;
  messageCount: number;
};

export type PeopleReviewLink = {
  incomingName: string;
  existingName: string;
};

type PeopleReviewModalProps = {
  isOpen: boolean;
  chatTitle?: string;
  people: PeopleReviewPerson[];
  personFieldDecisions: Record<
    string,
    {
      fullName: boolean;
      firstName: boolean;
      lastNames: boolean;
      aliases: boolean;
    }
  >;
  onPersonFieldToggle: (
    fullName: string,
    field: "fullName" | "firstName" | "lastNames" | "aliases",
    value: boolean,
  ) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function PeopleReviewModal({
  isOpen,
  chatTitle,
  people,
  personFieldDecisions,
  onPersonFieldToggle,
  onClose,
  onConfirm,
}: PeopleReviewModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm px-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold">Confirm People Extraction</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {chatTitle ? `Chat: ${chatTitle}` : "Review extracted people before continuing."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="p-4">
          <p className="mb-2 text-sm font-semibold">Detected People</p>
          <ScrollArea className="h-[420px] rounded-md border border-slate-300 p-3 dark:border-slate-700">
            <div className="space-y-3">
              {people.length === 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-300">No people detected.</p>
              )}
              {people.map((person) => (
                <div key={person.fullName} className="rounded-md border border-slate-300 p-3 text-xs dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{person.fullName}</p>
                    <p className="text-slate-600 dark:text-slate-300">Messages: {person.messageCount}</p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {([
                      {
                        field: "fullName" as const,
                        label: "Full name",
                        value: person.fullName || "(none)",
                      },
                      {
                        field: "firstName" as const,
                        label: "First name",
                        value: person.firstName || "(none)",
                      },
                      {
                        field: "lastNames" as const,
                        label: "Last name(s)",
                        value: person.lastNames.join(", ") || "(none)",
                      },
                      {
                        field: "aliases" as const,
                        label: "Aliases",
                        value: person.aliases.join(", ") || "(none)",
                      },
                    ]).map((item) => {
                      const selected = personFieldDecisions[person.fullName]?.[item.field] ?? true;

                      return (
                        <div key={`${person.fullName}-${item.field}`} className="rounded border border-slate-200 p-2 dark:border-slate-700">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-[11px] uppercase tracking-wide text-slate-500">{item.label}</p>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                className="size-7"
                                variant={selected ? "default" : "outline"}
                                aria-label={`Keep ${item.label} for ${person.fullName}`}
                                onClick={() => onPersonFieldToggle(person.fullName, item.field, true)}
                              >
                                <Check className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                className="size-7"
                                variant={!selected ? "destructive" : "outline"}
                                aria-label={`Drop ${item.label} for ${person.fullName}`}
                                onClick={() => onPersonFieldToggle(person.fullName, item.field, false)}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          </div>
                          <p>{item.value}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center justify-between border-t border-slate-300 px-4 py-3 dark:border-slate-700">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {people.length} people
          </p>
          <Button type="button" onClick={onConfirm}>
            Save Review
          </Button>
        </div>
      </div>
    </div>
  );
}
