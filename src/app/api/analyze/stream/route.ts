import { sha256Hex , parseWhatsAppConversation } from "@/lib/utils";
import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";

import { suggestConversationTitle } from "@/lib/analysis";
import { convexFns, getConvexAdminClient } from "@/lib/convex";
import { runPeopleLayer } from "@/lib/layers/people";

import { createLogger } from "@/lib/logger";
import type { PersonSummary } from "@/lib/types";


type StreamChat = {
  id: string;
  title?: string;
  conversation: string;
};

// ... include all the identity match helpers from original stream block

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function firstNameFromFullName(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean)[0] || "";
}

function lastNamesFromFullName(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean).slice(1);
}

function splitNameParts(value: string): { firstName: string; lastNames: string[] } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastNames: parts.slice(1) };
}

const NICKNAME_GROUPS = [
  ["ben", "benjamin", "benny"], ["stacy", "stacey"], ["mike", "michael"],
  ["alex", "alexander", "alexandra"], ["sam", "samuel", "samantha"],
  ["liz", "elizabeth", "beth", "lizzy"], ["jon", "john", "johnny"],
  ["kate", "katherine", "kathryn", "katie"], ["matt", "matthew"],
  ["chris", "christopher", "christina"], ["rob", "robert", "bobby"],
  ["will", "william", "bill", "billy"]
] as const;

const nicknameLookup = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) {
  for (const name of group) {
    const key = normalize(name);
    const current = nicknameLookup.get(key) ?? new Set<string>();
    for (const item of group) current.add(normalize(item));
    nicknameLookup.set(key, current);
  }
}

function expandFirstNameCandidates(value: string): string[] {
  const n = normalize(value);
  if (!n) return [];
  const expanded = new Set([n, ...(nicknameLookup.get(n) || [])]);
  return Array.from(expanded);
}

function namesAreRelated(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 3 && right.startsWith(left)) return true;
  if (right.length >= 3 && left.startsWith(right)) return true;
  return false;
}

function scoreIdentityCandidate(
  incoming: PersonSummary,
  existing: { personName: string; lastNames: string[]; aliases: string[] }
): number {
  const incomingName = normalize(incoming.name);
  const existingName = normalize(existing.personName);
  if (!incomingName || !existingName || incomingName === existingName) return -1;

  const inParts = splitNameParts(incoming.name);
  const exParts = splitNameParts(existing.personName);
  const inFirst = normalize(inParts.firstName);
  const exFirst = normalize(exParts.firstName);

  if (inFirst && exFirst && inFirst === exFirst) return 100;

  const inFirstExp = expandFirstNameCandidates(inFirst);
  const exFirstExp = expandFirstNameCandidates(exFirst);
  if (!inFirstExp.some(c => exFirstExp.some(o => namesAreRelated(c, o)))) return -1;

  const inLasts = new Set([...inParts.lastNames, ...incoming.aliases.flatMap((a) => splitNameParts(a).lastNames)].map(normalize).filter(Boolean));
  const exLasts = new Set([...exParts.lastNames, ...(existing.lastNames || [])].map(normalize).filter(Boolean));
  const lastNameOverlap = Array.from(inLasts).some((p) => exLasts.has(p));

  const inAlias = new Set([incoming.name, ...incoming.aliases].map(normalize).filter(Boolean));
  const exAlias = new Set([existing.personName, ...(existing.aliases || [])].map(normalize).filter(Boolean));
  const aliasOverlap = Array.from(inAlias).some(a => exAlias.has(a));

  let score = inFirst === exFirst ? 2 : 1;
  if (lastNameOverlap) score += 3;
  else if (inLasts.size === 0 || exLasts.size === 0) score += 1;
  if (aliasOverlap) score += 2;
  return score;
}

function toChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createLogger("api.analyze.stream", { requestId });
  let chats: StreamChat[] = [];

  try {
    const body = await request.json();
    chats = Array.isArray(body?.chats) ? body.chats : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (chats.length === 0) return NextResponse.json({ error: "At least one chat is required." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(toChunk(event, data)));

      const run = async () => {
        const convex = getConvexAdminClient();
        const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
        const model = anthropic(modelName);

        emit("session_started", { totalChats: chats.length, startedAt: Date.now() });
        const allExtractedPeople: PersonSummary[] = [];
        const uniqueLinks = new Map<string, { incomingName: string; existingName: string }>();
        const sessionConversationIds: { id: string, conversationId: string }[] = [];

        for (const chat of chats) {
          const raw = String(chat.conversation ?? "").trim();
          if (!raw) { emit("chat_error", { chatId: chat.id, error: "Empty conversation." }); continue; }
          const parsed = parseWhatsAppConversation(raw);
          if (parsed.length === 0) { emit("chat_error", { chatId: chat.id, error: "No messages." }); continue; }

          const title = String(chat.title ?? "").trim() || suggestConversationTitle(parsed);
          const hash = await sha256Hex(raw);
          
          if (convex) {
            const existing = await convex.query(convexFns.checkConversationHashes, { hashes: [hash] });
            if (existing.length > 0) {
              emit("chat_duplicate", { chatId: chat.id, title, conversationId: existing[0].conversationId, error: "Already analyzed." });
              continue;
            }
          }

          emit("layer_started", { chatId: chat.id, layer: "people" });
          const people = await runPeopleLayer(parsed, model);
          allExtractedPeople.push(...people);
          
          let conversationId = "NO_ID";
          if (convex) {
            const res = await convex.mutation(convexFns.savePhase1Draft, {
              title,
              rawText: raw,
              conversationHash: hash,
              messages: parsed,
              people
            });
            if (res.duplicate) {
              emit("chat_duplicate", { chatId: chat.id, title, conversationId: res.conversationId, error: "Already analyzed." });
              continue;
            }
            conversationId = res.conversationId as string;
            sessionConversationIds.push({ id: chat.id, conversationId });
          }
          
          emit("people_delta", { chatId: chat.id, people });
          emit("layer_done", { chatId: chat.id, layer: "people", count: people.length });
        }

        // Global Link Resolution
        if (convex && allExtractedPeople.length > 0) {
          const firstNames = Array.from(new Set(allExtractedPeople.map(p => normalize(firstNameFromFullName(p.name))).filter(Boolean)));
          if (firstNames.length > 0) {
            const matches = await convex.query(convexFns.findPeopleByFirstNames, { firstNames });
            for (const person of allExtractedPeople) {
              let bestTarget: typeof matches[0] | null = null;
              let bestScore = -1;
              for (const match of matches) {
                const score = scoreIdentityCandidate(person, match);
                if (score > 3 && score > bestScore) {
                  bestScore = score;
                  bestTarget = match;
                }
              }
              if (bestTarget) {
                const k = `${normalize(person.name)}|${normalize(bestTarget.personName)}`;
                if (!uniqueLinks.has(k)) {
                  uniqueLinks.set(k, { incomingName: person.name, existingName: bestTarget.personName });
                }
              }
            }
          }
        }

        // Group the globally extracted people so the modal is clean.
        const consolidated = Array.from(
          allExtractedPeople.reduce((acc, p) => {
             const key = normalize(p.name);
             if (!acc.has(key)) acc.set(key, {...p});
             else acc.get(key)!.messageCount += p.messageCount; // simplistic aggregation
             return acc;
          }, new Map<string, PersonSummary>()).values()
        );

        emit("people_review_prompt", {
           reviewPeople: consolidated.map(p => {
             const parts = splitNameParts(p.name);
             return { fullName: p.name, firstName: parts.firstName, lastNames: parts.lastNames, aliases: p.aliases, summary: p.summary, messageCount: p.messageCount };
           }),
           potentialLinks: Array.from(uniqueLinks.values()),
           draftChats: sessionConversationIds
        });

        emit("session_paused_review", {
           pausedAt: Date.now(),
           pendingReason: "awaiting_global_people_review"
        });

        controller.close();
      };
      run().catch((err) => {
        logger.error("stream_error", { error: err.stack });
        emit("session_error", { error: err.message });
        controller.close();
      });
    }
  });

  return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}
