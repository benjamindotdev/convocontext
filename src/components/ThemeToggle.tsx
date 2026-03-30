"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const currentTheme = hasMounted ? (theme ?? "system") : "system";

  const cycleTheme = () => {
    if (currentTheme === "system") {
      setTheme("light");
      return;
    }
    if (currentTheme === "light") {
      setTheme("dark");
      return;
    }
    setTheme("system");
  };

  return (
    <div className="mt-auto">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={cycleTheme}
        aria-label="Change theme"
      >
        {currentTheme === "dark" ? (
          <Moon className="size-4" />
        ) : currentTheme === "light" ? (
          <Sun className="size-4" />
        ) : (
          <Monitor className="size-4" />
        )}
        Theme: {currentTheme}
      </Button>
    </div>
  );
}
