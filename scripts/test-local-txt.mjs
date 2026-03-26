#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const TARGET_DIR = path.resolve(process.cwd(), "local-txt");
const ANALYZE_ENDPOINT = process.env.ANALYZE_ENDPOINT || "http://localhost:3000/api/analyze";

const CHAT_PATTERNS = [
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APMapm]{0,2})\s-\s([^:]+):\s([\s\S]*)$/,
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?[APMapm]{0,2})\]\s([^:]+):\s([\s\S]*)$/,
];

function parseWhatsAppConversation(raw) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const messages = [];
  let unmatchedLines = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trimEnd();
    if (!line) continue;

    let matched = false;

    for (const pattern of CHAT_PATTERNS) {
      const result = line.match(pattern);
      if (!result) continue;

      const [, date, time, speaker, text] = result;
      messages.push({
        speaker: speaker.trim(),
        text: text.trim(),
        timestamp: `${date} ${time}`,
        line: i + 1,
      });

      matched = true;
      break;
    }

    if (!matched && messages.length > 0) {
      messages[messages.length - 1].text = `${messages[messages.length - 1].text}\n${line}`.trim();
    } else if (!matched) {
      unmatchedLines += 1;
    }
  }

  return { messages, unmatchedLines };
}

async function listTextFiles(dir) {
  const entries = await readdir(dir);
  const txtFiles = [];

  for (const name of entries) {
    const fullPath = path.join(dir, name);
    const info = await stat(fullPath);
    if (info.isFile() && name.toLowerCase().endsWith(".txt")) {
      txtFiles.push(fullPath);
    }
  }

  return txtFiles.sort((a, b) => a.localeCompare(b));
}

async function run() {
  let files;

  try {
    files = await listTextFiles(TARGET_DIR);
  } catch (error) {
    console.error(`Could not read folder: ${TARGET_DIR}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(`No .txt files found in ${TARGET_DIR}`);
    console.log("Drop your WhatsApp export files there and rerun this script.");
    process.exit(0);
  }

  let failures = 0;
  const reports = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const { messages, unmatchedLines } = parseWhatsAppConversation(content);

    const speakers = new Set(messages.map((m) => m.speaker));
    const pass = messages.length > 0;

    if (!pass) failures += 1;

    const result = pass ? "PASS" : "FAIL";
    const details = [
      `messages=${messages.length}`,
      `speakers=${speakers.size}`,
      `unmatchedStartLines=${unmatchedLines}`,
    ].join(" | ");

    console.log(`[${result}] ${path.basename(filePath)} -> ${details}`);

    if (!pass) {
      continue;
    }

    try {
      const response = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation: content }),
      });

      const body = await response.json();

      if (!response.ok) {
        reports.push({
          fileName: path.basename(filePath),
          ok: false,
          error: body?.error || `HTTP ${response.status}`,
        });
        continue;
      }

      reports.push({
        fileName: path.basename(filePath),
        ok: true,
        title: body?.title || "Untitled",
        people: body?.analysis?.people || [],
        events: body?.analysis?.events || [],
        themes: body?.analysis?.themes || [],
      });
    } catch (error) {
      reports.push({
        fileName: path.basename(filePath),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed parsing.`);
    process.exit(1);
  }

  console.log("\nDetailed analysis results:");

  for (const report of reports) {
    console.log(`\n=== ${report.fileName} ===`);

    if (!report.ok) {
      console.log(`Analyze API: FAIL -> ${report.error}`);
      continue;
    }

    const peopleNames = report.people.map((person) => person.name);
    const eventTitles = report.events.map((event) => event.title);
    const themeNames = report.themes.map((theme) => theme.name);

    console.log(`Analyze API: PASS`);
    console.log(`Title: ${report.title}`);
    console.log(`People (${peopleNames.length}): ${peopleNames.join(" | ") || "None"}`);
    console.log(`Events (${eventTitles.length}): ${eventTitles.join(" | ") || "None"}`);
    console.log(`Themes (${themeNames.length}): ${themeNames.join(" | ") || "None"}`);

    const normalized = new Set(peopleNames.map((name) => name.toLowerCase().trim()));
    const expectedPeople = ["ann luth", "stacy jones"];
    const hasOnlyExpectedPair =
      normalized.size === 2 && expectedPeople.every((name) => normalized.has(name));

    console.log(
      `Expected pair only (Ann Luth + Stacy Jones): ${hasOnlyExpectedPair ? "YES" : "NO"}`,
    );
  }

  console.log("\nAll .txt files parsed successfully.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
