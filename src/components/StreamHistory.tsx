import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { StreamHistoryItem } from "@/lib/types";

export function StreamHistory({
  streamHistory,
  setStreamHistory,
  setIsExportModalOpen
}: {
  streamHistory: StreamHistoryItem[];
  setStreamHistory: (history: StreamHistoryItem[]) => void;
  setIsExportModalOpen: (val: boolean) => void;
}) {
  return (
    <aside className="min-h-0 space-y-3">
      <Button type="button" className="w-full" onClick={() => setIsExportModalOpen(true)}>
        Export Selected Messages
      </Button>
      <Card className="flex h-full min-h-0 flex-col border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
        <CardHeader className="space-y-2">
          <CardTitle>Stream History</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Live stream events from the analysis pipeline.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col space-y-3">
          <Button
            variant="outline"
            className="w-full"
            disabled={streamHistory.length === 0}
            onClick={() => setStreamHistory([])}
          >
            Clear Stream History
          </Button>
          <ScrollArea className="h-full w-full pr-3">
            <div className="space-y-2">
              {streamHistory.length === 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-300">No stream events yet.</p>
              )}

              {streamHistory.map((item) => (
                <div key={item.id} className="animate-in fade-in-50 duration-200 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
                  <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{item.detail}</p>
                  {(item.chatId || item.layer) && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      {[item.chatId ? "Chat update" : null, item.layer ? `Now in ${item.layer} layer` : null]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </aside>
  );
}
