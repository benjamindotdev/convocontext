import { sha256Hex } from "@/lib/utils";
"use client";

import { useEffect, useState } from "react";
import { PeopleReviewModal} from "@/components/PeopleReviewModal";
import {
  ConversationAnalysis,
  SessionChat,
  LibraryConversation,
  StreamHistoryItem,
} from "@/lib/types";

import { Sidebar } from "./Sidebar";
import { Upload } from "./Upload";
import { Chats } from "./Chats";
import { Library } from "./Library";
import { StreamHistory } from "./StreamHistory";
import { ThemeToggle } from "./ThemeToggle";
import { PeopleTab } from "./PeopleTab";
import { EventsTab } from "./EventsTab";
import { ThemesTab } from "./ThemesTab";
import { Header } from "./Header";
import { DashboardHeader } from "./DashboardHeader";
import { ExportModal } from "./ExportModal";
import { usePeopleReview } from "@/hooks/usePeopleReview";
import { useUnifiedData } from "@/hooks/useUnifiedData";
import { useSessionStream } from "@/hooks/useSessionStream";

export function AnalyzerDashboard({
  initialLibraryConversations,
}: {
  initialLibraryConversations: LibraryConversation[];
}) {
  const [sessionChats, setSessionChats] = useState<SessionChat[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeChatLabel, setActiveChatLabel] = useState<string>("");
  const [activeLayerLabel, setActiveLayerLabel] = useState<string>("");
  const [streamHistory, setStreamHistory] = useState<StreamHistoryItem[]>([]);
  const [libraryConversations, setLibraryConversations] = useState<
    LibraryConversation[]
  >(initialLibraryConversations);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isLoadingConversationId, setIsLoadingConversationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const {
    peopleReviewModalOpen,
    setPeopleReviewModalOpen,
    peopleReviewChatTitle,
    setPeopleReviewChatTitle,
    peopleReviewChatId,
    setPeopleReviewChatId,
    peopleReviewPeople,
    setPeopleReviewPeople,
    peopleReviewFieldDecisions,
    setPeopleReviewFieldDecisions,
    updatePersonFieldDecision,
    promptedPeopleReviewRef
  } = usePeopleReview();

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const refreshLibraryConversations = async () => {
    setIsLibraryLoading(true);
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load conversation library.");
      }

      const payload = await response.json();
      const items = Array.isArray(payload?.conversations)
        ? payload.conversations
        : [];
      setLibraryConversations(items as LibraryConversation[]);
    } catch {
      // Keep UI functional even if library fetch fails temporarily.
    } finally {
      setIsLibraryLoading(false);
    }
  };

  useEffect(() => {
    void refreshLibraryConversations();
  }, []);

  const { analyzeSession, savePeopleReview } = useSessionStream({
    sessionChats,
    setSessionChats,
    refreshLibraryConversations,
    promptedPeopleReviewRef,
    setPeopleReviewModalOpen,
    setPeopleReviewChatTitle,
    setPeopleReviewChatId,
    setPeopleReviewPeople,
    setPeopleReviewFieldDecisions,
    peopleReviewChatId,
    peopleReviewPeople,
    peopleReviewFieldDecisions,
    setIsAnalyzing,
    setActiveChatLabel,
    setActiveLayerLabel,
    setError,
    setStreamHistory,
  });

  const unified = useUnifiedData(sessionChats);

  async function loadConversationFromLibrary(conversationId: string) {
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
  }

  return (
    <div className="relative h-screen overflow-hidden bg-slate-100 dark:bg-slate-950">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-4 py-4">
        <Header />

        <main className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[320px_1fr_320px]">
          <Sidebar>
            <Upload
                isAnalyzing={isAnalyzing}
                activeChatLabel={activeChatLabel}
                activeLayerLabel={activeLayerLabel}
                sessionChats={sessionChats}
                setSessionChats={setSessionChats}
                error={error}
                setError={setError}
                analyzeSession={analyzeSession}
                onClearSession={() => {
                    setSessionChats([]);
                    setError(null);
                    setStreamHistory([]);
                }}
            />

            <Chats sessionChats={sessionChats} />

            <Library
              isLibraryLoading={isLibraryLoading}
              libraryConversations={libraryConversations}
              sessionChats={sessionChats}
              setSessionChats={setSessionChats}
              setError={setError}
            />

            <ThemeToggle />
          </Sidebar>

          <section className="min-h-0 space-y-6 overflow-y-auto pr-1">
            <DashboardHeader
              completedCount={unified.completedCount}
              messageTotal={unified.messageTotal}
              peopleCount={unified.people.length}
              eventsCount={unified.events.length}
              themesCount={unified.themes.length}
            />

            <div className="space-y-6">
                <PeopleTab people={unified.people} />
                <EventsTab events={unified.events} />
                <ThemesTab themes={unified.themes} />
            </div>
          </section>

          <Sidebar className="space-y-3 gap-0">
            <StreamHistory
              streamHistory={streamHistory}
              setStreamHistory={setStreamHistory}
              setIsExportModalOpen={setIsExportModalOpen}
            />
          </Sidebar>
        </main>
      </div>

    <ExportModal 
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        unified={unified}
        sessionChats={sessionChats}
        setError={setError}
      />

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
