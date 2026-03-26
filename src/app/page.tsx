"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConversationAnalysis } from "@/lib/types";

type ConversationListItem = {
  _id: string;
  title: string;
  createdAt: number;
};

const demoInput = `12/04/2025, 8:14 PM - Alex: You said you'd transfer the invoice amount by Monday.
12/04/2025, 8:20 PM - Jordan: I can do half now and the rest after the tenant signs.
12/05/2025, 9:07 AM - Alex: We also need to discuss the lock change from last week.
12/05/2025, 9:09 AM - Jordan: I changed it because of the police report.`;

export default function Home() {
  const [conversation, setConversation] = useState(demoInput);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [analysisTitle, setAnalysisTitle] = useState<string>("Untitled analysis");
  const [savedConversations, setSavedConversations] = useState<ConversationListItem[]>([]);

  const summary = useMemo(() => {
    if (!analysis) {
      return null;
    }

    return {
      messages: analysis.messages.length,
      people: analysis.people.length,
      events: analysis.events.length,
      themes: analysis.themes.length,
    };
  }, [analysis]);

  useEffect(() => {
    void loadConversations();
  }, []);

  async function loadConversations() {
    const response = await fetch("/api/conversations");
    const data = await response.json();
    setSavedConversations(data.conversations ?? []);
  }

  async function handleAnalyze() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to analyze conversation.");
      }

      setAnalysis(data.analysis);
      setAnalysisTitle(data.title ?? "Untitled analysis");
      await loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadConversation(id: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load saved conversation.");
      }

      setConversation(data.conversation?.rawText ?? "");
      setAnalysis(data.analysis);
      setAnalysisTitle(data.conversation?.title ?? "Untitled analysis");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7_0%,_#f9fafb_45%,_#e0f2fe_100%)]">
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 md:grid-cols-[320px_1fr]">
        <Card className="border-slate-300/70 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Saved Analyses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                setConversation(demoInput);
                setAnalysis(null);
                setAnalysisTitle("Untitled analysis");
              }}
            >
              New Analysis
            </Button>

            <ScrollArea className="h-[420px] pr-3">
              <div className="space-y-2">
                {savedConversations.map((item) => (
                  <Button
                    key={item._id}
                    variant="ghost"
                    className="h-auto w-full justify-start text-left"
                    onClick={() => void handleLoadConversation(item._id)}
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <section className="space-y-6">
          <Card className="border-amber-500/25 bg-white/90 shadow-xl shadow-amber-200/40">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-amber-700">
                <Sparkles className="size-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em]">
                  ConvoContext
                </p>
              </div>
              <CardTitle className="text-2xl">Legal Conversation Context Builder</CardTitle>
              <p className="text-sm text-muted-foreground">
                Paste a WhatsApp export and run layered analysis across people,
                events, and themes.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={conversation}
                onChange={(event) => setConversation(event.target.value)}
                className="min-h-64 bg-white"
                placeholder="Paste WhatsApp export text..."
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={loading} onClick={() => void handleAnalyze()}>
                  {loading ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Analyzing
                    </>
                  ) : (
                    "Analyze Conversation"
                  )}
                </Button>
                {summary && (
                  <>
                    <Badge variant="secondary">{summary.messages} messages</Badge>
                    <Badge variant="secondary">{summary.people} people</Badge>
                    <Badge variant="secondary">{summary.events} events</Badge>
                    <Badge variant="secondary">{summary.themes} themes</Badge>
                  </>
                )}
              </div>

              {error && (
                <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>

          {analysis && (
            <Card className="border-slate-300/70 bg-white/90">
              <CardHeader>
                <CardTitle>{analysisTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="messages" className="space-y-4">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="messages">Messages</TabsTrigger>
                    <TabsTrigger value="people">People</TabsTrigger>
                    <TabsTrigger value="events">Events</TabsTrigger>
                    <TabsTrigger value="themes">Themes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="messages">
                    <ScrollArea className="h-[420px] pr-3">
                      <div className="space-y-3">
                        {analysis.messages.map((message) => (
                          <div key={`${message.line}-${message.speaker}`}>
                            <p className="text-xs text-muted-foreground">
                              Line {message.line}
                              {message.timestamp ? ` • ${message.timestamp}` : ""}
                            </p>
                            <p className="font-medium">{message.speaker}</p>
                            <p className="text-sm">{message.text}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="people">
                    <div className="space-y-4">
                      {analysis.people.map((person) => (
                        <div key={person.name} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{person.name}</p>
                            <Badge variant="outline">{person.messageCount} messages</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{person.summary}</p>
                          {person.aliases.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Aliases: {person.aliases.join(", ")}
                            </p>
                          )}
                          <Separator />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="events">
                    <div className="space-y-4">
                      {analysis.events.map((event) => (
                        <div key={event.title} className="space-y-2">
                          <p className="font-semibold">{event.title}</p>
                          <p className="text-sm text-muted-foreground">{event.description}</p>
                          <div className="flex flex-wrap gap-2">
                            {event.participants.map((participant) => (
                              <Badge key={`${event.title}-${participant}`} variant="outline">
                                {participant}
                              </Badge>
                            ))}
                            {event.topics.map((topic) => (
                              <Badge key={`${event.title}-${topic}`} variant="secondary">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Timeframe: {event.timeframe}
                            {event.evidenceLines.length > 0
                              ? ` • Evidence lines: ${event.evidenceLines.join(", ")}`
                              : ""}
                          </p>
                          <Separator />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="themes">
                    <div className="space-y-4">
                      {analysis.themes.map((theme) => (
                        <div key={theme.name} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{theme.name}</p>
                            <Badge variant="outline">
                              Confidence {Math.round(theme.confidence * 100)}%
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{theme.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Keywords: {theme.keywords.join(", ") || "None"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Linked events: {theme.eventTitles.join(", ") || "None"}
                          </p>
                          <Separator />
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
