import { sha256Hex } from "@/lib/utils";
import React, { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, LoaderCircle, Trash2 } from "lucide-react";
import { SessionChat } from "@/lib/types";


export function Upload({
  isAnalyzing,
  activeChatLabel,
  activeLayerLabel,
  sessionChats,
  setSessionChats,
  setError,
  error,
  analyzeSession,
  onClearSession
}: {
  isAnalyzing: boolean;
  activeChatLabel: string;
  activeLayerLabel: string;
  sessionChats: SessionChat[];
  setSessionChats: React.Dispatch<React.SetStateAction<SessionChat[]>>;
  setError: (err: string | null) => void;
  error: string | null;
  analyzeSession: () => Promise<void>;
  onClearSession: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const incoming: SessionChat[] = [];
    const allHashes: string[] = [];

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".txt")) continue;

      const text = await file.text();
      const id = `${file.name}::${file.lastModified}::${file.size}`;
      const conversationHash = await sha256Hex(text.trim());

      allHashes.push(conversationHash);

      incoming.push({
        id,
        fileName: file.name,
        text,
        conversationHash,
        status: "queued",
      });
    }

    if (incoming.length === 0) {
      setError("No valid .txt files were selected.");
      return;
    }

    let existingByHash = new Set<string>();
    let existingByHashInfo = new Map<
      string,
      { conversationId?: string; title?: string }
    >();

    try {
      const response = await fetch("/api/conversations/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: allHashes }),
      });

      if (response.ok) {
        const payload = await response.json();
        const existing = Array.isArray(payload?.existing)
          ? payload.existing
          : [];
        existingByHash = new Set(
          existing
            .map((item: { hash?: string }) => String(item.hash ?? ""))
            .filter((hash: string) => hash.length > 0),
        );

        const hashEntries: Array<
          [string, { conversationId?: string; title?: string }]
        > = existing
          .map(
            (item: {
              hash?: string;
              conversationId?: string;
              title?: string;
            }) => {
              const hash = String(item.hash ?? "");
              return [
                hash,
                {
                  conversationId: item.conversationId,
                  title: item.title,
                },
              ];
            },
          )
          .filter(
            (entry: [string, { conversationId?: string; title?: string }]) =>
              entry[0].length > 0,
          );

        existingByHashInfo = new Map(hashEntries);
      }
    } catch {
      // Allow local queueing even if dedupe check endpoint is temporarily unavailable.
    }

    setSessionChats((current) => {
      const existingIds = new Set(current.map((chat) => chat.id));
      const existingHashes = new Set(
        current.map((chat) => chat.conversationHash),
      );

      const nextEntries: SessionChat[] = [];

      for (const chat of incoming) {
        const duplicateInSession =
          existingIds.has(chat.id) || existingHashes.has(chat.conversationHash);
        const duplicateInDatabase = existingByHash.has(chat.conversationHash);

        if (!duplicateInSession && !duplicateInDatabase) {
          nextEntries.push(chat);
          existingIds.add(chat.id);
          existingHashes.add(chat.conversationHash);
          continue;
        }

        const existingInfo = existingByHashInfo.get(chat.conversationHash);

        nextEntries.push({
          ...chat,
          conversationId: existingInfo?.conversationId,
          status: "duplicate",
          error: existingInfo?.title
            ? `Already analyzed as "\${existingInfo.title}\".`
            : "This conversation has already been analyzed.",
        });
        existingIds.add(chat.id);
        existingHashes.add(chat.conversationHash);
      }

      return [...current, ...nextEntries];
    });

    setError(null);
  };


  return (
    <Card className="border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 shadow-xl shadow-slate-300/30 dark:shadow-slate-900/40">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl">Session Intake</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Upload one or more WhatsApp `.txt` exports for shared context
          analysis.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!isAnalyzing) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (!isAnalyzing) {
              void addFiles(event.dataTransfer.files);
            }
          }}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? "border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800"
              : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          }`}
        >
          <FileUp className="mx-auto mb-3 size-7 text-slate-700 dark:text-slate-200" />
          <p className="font-medium">Drag and drop chat `.txt` files</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Multiple files supported.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            disabled={isAnalyzing}
            onClick={() => fileInputRef.current?.click()}
          >
            Select Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Select WhatsApp chat text files"
            accept=".txt,text/plain"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={isAnalyzing}
            onClick={() => void analyzeSession()}
          >
            {isAnalyzing ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Analyzing
              </>
            ) : (
              "Analyze Session"
            )}
          </Button>
          <Button
            variant="outline"
            disabled={isAnalyzing || sessionChats.length === 0}
            onClick={onClearSession}
          >
            <Trash2 className="size-4" />
            Clear Session
          </Button>
        </div>

        {isAnalyzing && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Running analysis...{" "}
            {activeChatLabel
              ? `Current: ${activeChatLabel}${activeLayerLabel ? ` (${activeLayerLabel})` : ""}`
              : "Preparing next chat"}
          </p>
        )}

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
