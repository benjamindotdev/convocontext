import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UnifiedTheme, ThemeSortOption, SortDirection } from "@/lib/types";
import { ContentTab } from "./ContentTab";

export function ThemesTab({ themes }: { themes: UnifiedTheme[] }) {
  const [themesCollapsed, setThemesCollapsed] = useState(true);
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [themeSort, setThemeSort] = useState<ThemeSortOption>("alphabet");
  const [themeSortDirection, setThemeSortDirection] =
    useState<SortDirection>("asc");

  const sortedThemes = useMemo(() => {
    const copy = [...themes];
    if (themeSort === "alphabet") {
      copy.sort((a, b) =>
        themeSortDirection === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name),
      );
      return copy;
    }

    if (themeSort === "messages") {
      copy.sort((a, b) =>
        themeSortDirection === "asc"
          ? a.linkedMessages.length - b.linkedMessages.length
          : b.linkedMessages.length - a.linkedMessages.length,
      );
      return copy;
    }

    return copy;
  }, [themes, themeSort, themeSortDirection]);

  return (
    <ContentTab
      title="Themes"
      count={themes.length}
      collapsed={themesCollapsed}
      onToggleCollapse={() => setThemesCollapsed((current) => !current)}
      headerControls={
        <>
          <label className="flex items-center gap-2">
            Sort
            <select
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              value={themeSort}
              onChange={(event) =>
                setThemeSort(event.target.value as ThemeSortOption)
              }
            >
              <option value="alphabet">Alphabet</option>
              <option value="messages">Message amount</option>
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setThemeSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              )
            }
          >
            {themeSortDirection === "asc" ? "Asc" : "Desc"}
          </Button>
        </>
      }
      hasItems={themes.length > 0}
      items={sortedThemes}
      emptyMessage="Themes appear after analysis starts."
      renderItem={(theme) => (
        <div
          key={theme.name}
          className="animate-in fade-in-50 duration-200 space-y-2"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() =>
              setOpenTheme((current) =>
                current === theme.name ? null : theme.name,
              )
            }
          >
            <p className="font-semibold">{theme.name}</p>
            <Badge variant="secondary">
              {theme.linkedMessages.length} linked
            </Badge>
          </button>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Chats: {theme.chats.join(" | ") || "None"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Keywords: {theme.keywords.join(", ") || "None"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Linked events: {theme.eventTitles.join(" | ") || "None"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Detail: {theme.descriptions[0] || "None"}
          </p>
          {openTheme === theme.name && (
            <div className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Linked messages
              </p>
              <div className="space-y-2">
                {theme.linkedMessages.slice(0, 40).map((message) => (
                  <div key={message.id} className="text-xs">
                    <p className="font-mono text-slate-600 dark:text-slate-300">
                      {message.id} | {message.chat} | line {message.line}
                    </p>
                    <p>
                      <span className="font-semibold">{message.speaker}</span>
                      {message.timestamp ? ` (${message.timestamp})` : ""}
                      : {message.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Separator />
        </div>
      )}
    />
  );
}
