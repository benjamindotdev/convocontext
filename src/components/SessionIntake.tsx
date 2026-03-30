import { FileUp, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionChat } from "@/lib/types";
import { prettyStatus, statusVariant } from "@/lib/utils";

export function SessionIntake({
  isAnalyzing,
  isDragging,
  setIsDragging,
  fileInputRef,
  addFiles,
  analyzeSession,
  sessionChats,
  setSessionChats,
  setError,
  setStreamHistory,
  activeChatLabel,
  activeLayerLabel,
  error
}: {
  isAnalyzing: boolean;
  isDragging: boolean;
  setIsDragging: (val: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (files: FileList | null) => void;
  analyzeSession: () => void;
  sessionChats: SessionChat[];
  setSessionChats: (chats: [] | ((c: SessionChat[]) => SessionChat[])) => void;
  setError: (val: string | null) => void;
  setStreamHistory: (val: []) => void;
  activeChatLabel: string;
  activeLayerLabel: string;
  error: string | null;
}) {
  return (
    <>
      <Card className="border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 shadow-xl shadow-slate-300/30 dark:shadow-slate-900/40">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Session Intake</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Upload one or more WhatsApp `.txt` exports for shared context analysis.
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
              isDragging ? "border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800" : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            }`}
          >
            <FileUp className="mx-auto mb-3 size-7 text-slate-700 dark:text-slate-200" />
            <p className="font-medium">Drag and drop chat `.txt` files</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Multiple files supported.</p>
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
            <Button disabled={isAnalyzing} onClick={() => void analyzeSession()}>
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
              onClick={() => {
                setSessionChats([]);
                setError(null);
                setStreamHistory([]);
              }}
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

      <Card className="flex min-h-0 flex-1 flex-col border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
        <CardHeader className="space-y-2">
          <CardTitle>Uploaded Chats</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">Each chat keeps source attribution.</p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1">
          <div className="min-h-0 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 shadow-inner overflow-y-auto">
            {sessionChats.length === 0 ? (
              <p className="text-sm text-slate-500 italic mt-2">No files uploaded yet.</p>
            ) : (
              <div className="space-y-3 mt-2">
                {sessionChats.map((chat) => (
                  <div key={chat.id} className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{chat.fileName}</p>
                      <Badge variant={statusVariant(chat.status)}>{prettyStatus(chat.status)}</Badge>
                    </div>
                    {chat.status === "error" && chat.error && (
                      <p className="mt-1 text-xs text-red-600">{chat.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
