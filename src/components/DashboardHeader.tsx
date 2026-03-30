import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardHeaderProps {
  completedCount: number;
  messageTotal: number;
  peopleCount: number;
  eventsCount: number;
  themesCount: number;
}

export function DashboardHeader({
  completedCount,
  messageTotal,
  peopleCount,
  eventsCount,
  themesCount,
}: DashboardHeaderProps) {
  return (
    <Card className="animate-in fade-in-50 duration-300 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {completedCount} chats analyzed
          </Badge>
          <Badge variant="secondary">
            {messageTotal} total messages
          </Badge>
          <Badge variant="secondary">
            {peopleCount} people
          </Badge>
          <Badge variant="secondary">
            {eventsCount} events
          </Badge>
          <Badge variant="secondary">
            {themesCount} themes
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
