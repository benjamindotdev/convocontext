import { sha256Hex } from "@/lib/utils";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";
import { LibraryConversation, SessionChat, ConversationAnalysis } from "@/lib/types";

import { useState } from "react";

export function Library({
  isLibraryLoading,
  libraryConversations,
  sessionChats,
  setSessionChats,
  setError,
}: {
  isLibraryLoading: boolean;
  libraryConversations: LibraryConversation[];
  sessionChats: SessionChat[];
  setSessionChats: React.Dispatch<React.SetStateAction<SessionChat[]>>;
  setError: (error: string | null) => void;
}) {
  const [isLoadingConversationId, setIsLoadingConversationId] = useState<string | null>(null);

  const loadConversationFromLibrary = async (conversationId: string) => {
    if (!conversationId) return;

    setIsLoadingConversationId(conversationId);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        cache: "no-store",
      });

      const payload = await response.json();

      if (!response.ok || !payload?.conversation || !payload?.analysis) {
        throw new Error(
          payload?.error || "Failed to load conversation from library.",
        );
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
          chat.conversationId === conversation._id ||
          chat.conversationHash === conversationHash,
      );

      if (alreadyLoaded) {
        setError(
          "This analyzed conversation is already in the current session.",
        );
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
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to load conversation from library.",
      );
    } finally {
      setIsLoadingConversationId(null);
    }
  };
  return (
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
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Loading conversation library...
              </p>
            )}

            {!isLibraryLoading && libraryConversations.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No analyzed conversations found.
              </p>
            )}

            {libraryConversations.map((conversation) => (
              <div
                key={conversation._id}
                className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 p-3"
              >
                <p className="text-sm font-semibold">
                  {conversation.title}
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {new Date(
                    conversation.analyzedAt || conversation.createdAt,
                  ).toLocaleString()}
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
  );
}
