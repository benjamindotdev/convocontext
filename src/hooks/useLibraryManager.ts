import { useState, useCallback } from "react";
import { LibraryConversation } from "@/lib/types";

export function useLibraryManager({
  initialLibraryConversations,
}: {
  initialLibraryConversations: LibraryConversation[];
}) {
  const [libraryConversations, setLibraryConversations] = useState<
    LibraryConversation[]
  >(initialLibraryConversations);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);

  const refreshLibraryConversations = useCallback(async () => {
    setIsLibraryLoading(true);
    try {
      const resp = await fetch("/api/conversations");
      if (resp.ok) {
        const data = await resp.json();
        setLibraryConversations(data.conversations || []);
      }
    } catch (e) {
      console.error("Failed to refresh library", e);
    } finally {
      setIsLibraryLoading(false);
    }
  }, []);

  return {
    libraryConversations,
    isLibraryLoading,
    refreshLibraryConversations,
  };
}
