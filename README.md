# ConvoContext

ConvoContext analyzes full WhatsApp conversation history for legal context using layered AI extraction:

1. `people.ts` finds key individuals and aliases.
2. `events.ts` extracts concrete incidents with evidence lines.
3. `themes.ts` decides whether each topic belongs to an existing theme or a newly created theme.

The app uses:

- Next.js + TypeScript + Tailwind + shadcn/ui
- Anthropic via Next.js AI SDK
- Convex as a free hosted database option

## Environment Variables

Copy `.env.example` to `.env.local` and set:

```bash
ANTHROPIC_API_KEY=...
CONVEX_URL=...
```

`CONVEX_URL` is optional if you only want in-memory analysis results.

## Convex Setup

Run once to initialize Convex and create your cloud deployment:

```bash
npm run convex:dev
```

After setup, Convex functions in `convex/` are ready to store and retrieve analyses.

## Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## API Endpoints

- `POST /api/analyze` accepts raw WhatsApp export text and returns/stores layered analysis.
- `GET /api/conversations` lists saved analyses from Convex.
- `GET /api/conversations/:id` fetches a saved conversation plus analysis details.
