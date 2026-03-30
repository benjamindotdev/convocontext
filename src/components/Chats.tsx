import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SessionChat } from "@/lib/types";
import { statusVariant, prettyStatus } from "@/lib/utils";

export function Chats({ sessionChats }: { sessionChats: SessionChat[] }) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
      <CardHeader className="space-y-2">
        <CardTitle>Uploaded Chats</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Each chat keeps source attribution.
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1">
        <ScrollArea className="h-full w-full pr-3">
          <div className="space-y-3">
            {sessionChats.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No chats uploaded yet.
              </p>
            )}

            {sessionChats.map((chat) => (
              <div
                key={chat.id}
                className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {chat.fileName}
                  </p>
                  <Badge variant={statusVariant(chat.status)}>
                    {prettyStatus(chat.status)}
                  </Badge>
                </div>

                {chat.analysis && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {chat.analysis.messages.length} messages
                    </Badge>
                    <Badge variant="outline">
                      {chat.analysis.people.length} people
                    </Badge>
                    <Badge variant="outline">
                      {chat.analysis.events.length} events
                    </Badge>
                    <Badge variant="outline">
                      {chat.analysis.themes.length} themes
                    </Badge>
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
  );
}
