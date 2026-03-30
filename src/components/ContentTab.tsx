import React, { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ContentTabProps<T> {
  title: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  headerControls?: ReactNode;
  items: T[];
  renderItem: (item: T) => ReactNode;
  emptyMessage: string;
  searchEmptyMessage?: string;
  hasItems: boolean;
}

export function ContentTab<T>({
  title,
  count,
  collapsed,
  onToggleCollapse,
  headerControls,
  items,
  renderItem,
  emptyMessage,
  searchEmptyMessage,
  hasItems,
}: ContentTabProps<T>) {
  return (
    <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
      <CardHeader
        className="flex cursor-pointer flex-row items-center justify-between gap-3 select-none"
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleCollapse();
          }
        }}
      >
        <CardTitle>
          {title} ({count})
        </CardTitle>
        {headerControls && (
          <div onClick={(event) => event.stopPropagation()} className="flex items-center gap-2">
            {headerControls}
          </div>
        )}
      </CardHeader>
      {!collapsed && (
        <CardContent className="animate-in fade-in-50 duration-300">
          <ScrollArea className="h-[470px] pr-3">
            <div className="space-y-4">
              {items.map((item, index) => (
                <React.Fragment key={index}>
                  {renderItem(item)}
                </React.Fragment>
              ))}

              {!hasItems && (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {emptyMessage}
                </p>
              )}

              {hasItems && items.length === 0 && searchEmptyMessage && (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {searchEmptyMessage}
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}
