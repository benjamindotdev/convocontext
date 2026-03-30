import { SessionChat, StreamHistoryItem, StreamEvent, PersonSummary } from "@/lib/types";
import { parseSseBlock, emptyAnalysis } from "@/lib/utils";
import { PeopleReviewPerson } from "@/components/PeopleReviewModal";

export interface StreamDependencies {
  sessionChats: SessionChat[];
  setSessionChats: React.Dispatch<React.SetStateAction<SessionChat[]>>;
  refreshLibraryConversations: () => Promise<void>;
  promptedPeopleReviewRef: React.MutableRefObject<Set<string>>;
  setPeopleReviewModalOpen: (open: boolean) => void;
  setPeopleReviewChatTitle: (title: string) => void;
  setPeopleReviewChatId: (id: string) => void;
  setPeopleReviewPeople: (people: PeopleReviewPerson[]) => void;
  setPeopleReviewFieldDecisions: (decisions: any) => void;
  peopleReviewChatId: string;
  peopleReviewPeople: PeopleReviewPerson[];
  peopleReviewFieldDecisions: any;
  setIsAnalyzing: (analyzing: boolean) => void;
  setActiveChatLabel: (label: string) => void;
  setActiveLayerLabel: (label: string) => void;
  setError: (error: string | null) => void;
  setStreamHistory: React.Dispatch<React.SetStateAction<StreamHistoryItem[]>>;
}

export function useSessionStream(deps: StreamDependencies) {
  const {
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
  } = deps;
  const pushStreamHistory = (streamEvent: StreamEvent) => {
    const { event, data } = streamEvent;

    let title = "Update";
    let detail = "Pipeline updated.";

    if (event === "chat_started") {
      title = "Chat Started";
      detail = `Started ${data.title || data.chatId || "chat"}.`;
    }
    if (event === "layer_started") {
      title = "Layer Started";
      detail = `Running ${data.layer || "unknown"} layer.`;
    }
    if (event === "layer_done") {
      title = "Layer Complete";
      detail = `Finished ${data.layer || "unknown"} layer (${data.count ?? 0}).`;
    }
    if (event === "people_delta") {
      title = "People Updated";
      detail = `${data.people?.length ?? 0} people loaded.`;
    }
    if (event === "events_delta") {
      title = "Events Updated";
      detail = `${data.events?.length ?? 0} events loaded.`;
    }
    if (event === "themes_delta") {
      title = "Themes Updated";
      detail = `${data.themes?.length ?? 0} themes loaded.`;
    }
    if (event === "chat_done") {
      title = "Chat Complete";
      detail = `${data.title || data.chatId || "Chat"} finished.`;
    }
    if (event === "chat_error") {
      title = "Chat Error";
      detail = data.error || "Unexpected error.";
    }
    if (event === "chat_duplicate") {
      title = "Duplicate Skipped";
      detail = data.error || "Already analyzed.";
    }
    if (event === "session_started") {
      title = data.resumedFromReview ? "Resume Started" : "Session Started";
      detail = data.resumedFromReview
        ? "Continuing analysis after people review."
        : "Analysis session started.";
    }
    if (event === "session_done") {
      title = data.resumedFromReview ? "Resume Complete" : "Session Complete";
      detail = data.resumedFromReview
        ? "Review continuation finished."
        : "All chats finished.";
    }
    if (event === "session_error") {
      title = "Session Error";
      detail = data.error || "Unexpected error.";
    }
    if (event === "people_review_prompt") {
      title = "Review Needed";
      detail = `Please confirm ${data.reviewPeople?.length ?? 0} people before continuing.`;
    }
    if (event === "chat_paused_review") {
      title = "Paused For Review";
      detail = "Chat paused while waiting for people review.";
    }
    if (event === "session_paused_review") {
      title = "Session Paused";
      detail = "Session paused for people review.";
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setStreamHistory((current) => {
      const next = [
        {
          id,
          timestamp: Date.now(),
          title,
          chatId: data.chatId,
          layer: data.layer,
          detail,
        },
        ...current,
      ];
      return next.slice(0, 250);
    });
  }

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

    if (event === "people_review_prompt") {
      const people = data.reviewPeople || [];
      const reviewKey = `${chatId}:${people.map((person) => person.fullName).join("|")}`;

      if (promptedPeopleReviewRef.current.has(reviewKey)) {
        return;
      }
      promptedPeopleReviewRef.current.add(reviewKey);

      const initialFieldDecisions: Record<
        string,
        {
          fullName: boolean;
          firstName: boolean;
          lastNames: boolean;
          aliases: boolean;
        }
      > = {};

      for (const person of people) {
        initialFieldDecisions[person.fullName] = {
          fullName: true,
          firstName: true,
          lastNames: true,
          aliases: true,
        };
      }

      setPeopleReviewChatTitle(data.title || "");
      setPeopleReviewChatId(chatId);
      setPeopleReviewPeople(people);
      setPeopleReviewFieldDecisions(initialFieldDecisions);
      setPeopleReviewModalOpen(true);

      return;
    }

    if (event === "chat_paused_review" || event === "session_paused_review") {
      setIsAnalyzing(false);
      setActiveLayerLabel("");
      setActiveChatLabel("");
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
                  ? `Already analyzed as "${data.existingTitle}".`
                  : data.error ||
                    "This conversation has already been analyzed.",
              }
            : chat,
        ),
      );
      return;
    }
  }

  const savePeopleReview = async () => {
    const chat = sessionChats.find((item) => item.id === peopleReviewChatId);
    if (!chat) {
      setError("Could not resume analysis: chat not found.");
      setPeopleReviewModalOpen(false);
      return;
    }

    // Close immediately so save action always feels responsive.
    setPeopleReviewModalOpen(false);
    setIsAnalyzing(true);
    setActiveChatLabel(chat.title || chat.fileName);
    setActiveLayerLabel("review");

    const reviewedPeople: PersonSummary[] = peopleReviewPeople
      .map((person) => {
        const selection = peopleReviewFieldDecisions[person.fullName] || {
          fullName: true,
          firstName: true,
          lastNames: true,
          aliases: true,
        };

        const selectedName = selection.fullName
          ? person.fullName
          : [
              selection.firstName ? person.firstName : "",
              selection.lastNames ? person.lastNames.join(" ") : "",
            ]
              .join(" ")
              .trim();

        if (!selectedName) {
          return null;
        }

        return {
          name: selectedName,
          aliases: selection.aliases ? person.aliases : [],
          summary: person.summary,
          messageCount: person.messageCount,
        };
      })
      .filter((person): person is PersonSummary => Boolean(person));

    setError(null);

    try {
      const response = await fetch("/api/analyze/review/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          title: chat.title || chat.fileName,
          conversation: chat.text,
          reviewedPeople,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload?.error || "Failed to resume analysis after people review.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";


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

      let shouldContinue = false;

      setSessionChats((current) => {
        shouldContinue = current.some((item) => {
          if (item.id === chat.id) return false;
          return item.status === "queued" || item.status === "error";
        });
        return current;
      });

      const detail = `People review saved (${reviewedPeople.length} people)`;

      setStreamHistory((current) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [
          {
            id,
            timestamp: Date.now(),
            title: "Review Saved",
            detail,
          },
          ...current,
        ].slice(0, 250);
      });

      setPeopleReviewChatId("");
      setPeopleReviewPeople([]);
      setPeopleReviewFieldDecisions({});
      setIsAnalyzing(false);
      setActiveChatLabel("");
      setActiveLayerLabel("");

      if (shouldContinue) {
        setTimeout(() => {
          void analyzeSession();
        }, 0);
      } else {
        void refreshLibraryConversations();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to resume analysis after review.",
      );
      setIsAnalyzing(false);
      setActiveChatLabel("");
      setActiveLayerLabel("");
    }
  }

async function analyzeSession() {
    const queue = sessionChats.filter(
      (chat) => chat.status === "queued" || chat.status === "error",
    );

    if (queue.length === 0) {
      setError("Add one or more .txt chats before starting analysis.");
      return;
    }

    setError(null);
    setIsAnalyzing(true);
    setStreamHistory([]);
    promptedPeopleReviewRef.current.clear();
    setPeopleReviewModalOpen(false);
    setPeopleReviewChatId("");
    setPeopleReviewPeople([]);
    setPeopleReviewFieldDecisions({});

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
      setError(
        caught instanceof Error
          ? caught.message
          : "Unexpected streaming error.",
      );
      setSessionChats((current) =>
        current.map((item) =>
          item.status === "analyzing"
            ? {
                ...item,
                status: "error",
                error:
                  caught instanceof Error
                    ? caught.message
                    : "Unexpected streaming error",
              }
            : item,
        ),
      );
      setActiveChatLabel("");
      setActiveLayerLabel("");
      setIsAnalyzing(false);
    }
  }
  return { analyzeSession, savePeopleReview };
}

