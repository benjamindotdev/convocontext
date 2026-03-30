import React from "react";

export function Sidebar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <aside className={`flex min-h-0 flex-col gap-6 ${className}`.trim()}>
      {children}
    </aside>
  );
}
