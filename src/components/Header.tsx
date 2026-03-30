import { Sparkles } from "lucide-react";

export function Header() {
  return (
    <div className="mb-3 flex shrink-0 items-center gap-2 text-slate-700 dark:text-slate-200">
      <Sparkles className="size-4" />
      <p className="text-xs font-semibold uppercase tracking-[0.2em]">
        ConvoContext
      </p>
    </div>
  );
}
