# Discogs Photo Collector — Project Documentation

## Purpose

A personal tool to speed up cataloguing a physical vinyl collection on
Discogs. Instead of manually searching Discogs by hand for every record,
the workflow is: photograph the record → the app identifies it → confirm
the match → it's added to the Discogs collection in one tap.

## Scope

- **Single-user, personal-use tool.** Authenticates to Discogs with one
  personal access token tied to one account — not a multi-tenant product.
- **Vinyl-only.** Search results are filtered to the Discogs "Vinyl" format
  (covers all sizes — 7", 10", 12", LP, etc.) and exclude CD, cassette, and
  digital formats.
- **Mobile-first.** Designed to be used on a phone, camera in hand, while
  physically sorting through records.
- Out of scope: multi-user accounts/OAuth login, non-vinyl formats,
  bulk/batch import, editing existing collection entries.

## Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 18 + TypeScript | Server-rendered pages plus API routes in one deployable unit |
| Barcode scanning | `@zxing/browser` / `@zxing/library` | Runs client-side in the browser; tried first, before falling back to AI vision |
| Image identification | Google Gemini API (`@google/genai`) | Reads artist/title/label/catalogue number/barcode off a photo when no barcode is scannable. **Originally built on Anthropic Claude** (`claude-sonnet-5`); switched to Gemini's free tier — see [Decision log](#decision-log) |
| Record data | Discogs API (`lib/discogs.ts`) | Database search, release details, collection read/write, marketplace price suggestions |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Chosen after Vercel and Netlify — see [Decision log](#decision-log) |
| Deploy tooling kept in repo | `netlify.toml`, `deploy/` (systemd + webhook kit for self-hosting a VPS) | Not actively used, but left in place as working fallback options |

## Architecture

```
Browser (client)
  ├─ capture photo (camera or gallery picker)
  ├─ resize/re-encode client-side (keeps upload under serverless body limits)
  ├─ try barcode decode (ZXing, client-side)
  └─ POST /api/identify (photo) ──────────► Gemini vision → structured JSON
        │
        ▼
  Review stage (user edits artist / title / label / catalogue number)
        │
        ▼
  GET /api/discogs/search (structured fields, catalogue-number-first)
        │
        ▼
  Results list ── GET /api/discogs/release/[id]        (full release detail, on demand)
             ├── GET /api/discogs/collection-status     (already-owned check)
             └── GET /api/discogs/price-status           (median/max value estimate)
        │
        ▼
  POST /api/discogs/add → Discogs collection
```

All Discogs and Gemini credentials are read from server-side environment
variables inside the API routes — never sent to or exposed in the browser.

## Decision log

This is the practical R&D trail: what was tried, why it changed, and what
the working state is now. Kept for future review rather than as a polished
narrative.

### AI provider: Claude → Google Gemini

- **Initial build** used Anthropic Claude (`claude-sonnet-5`) for reading
  the record cover/label from the photo.
- **Changed to Google Gemini** (`@google/genai`, free tier) because the
  project has no budget for paid Claude API usage. Gemini's free tier
  (generous daily request allowance, no card required at this app's
  volume) covers the same job — read text off an image, return structured
  JSON.
- Two follow-up fixes were needed after the swap: Google deprecated
  `gemini-2.5-flash` earlier than announced (a live 404 in production), and
  the `gemini-flash-latest` alias turned out to silently resolve to that
  same deprecated model for this account. The fix was to query the
  account's actual available models (`GET /v1beta/models`) and pin to a
  concrete, confirmed-available model (`gemini-3.6-flash`) rather than
  trusting an alias.

### Hosting: Vercel → Netlify → Cloudflare Workers

- **Vercel** was the first target (dashboard-based deploy, no CLI access
  from this environment's sandboxed network). It ran into a broken
  GitHub↔Vercel Git connection — pushes silently stopped triggering new
  deployments, leaving the live site stuck on stale code for several
  commits before this was diagnosed and the project was re-imported.
  **Ultimately dropped because the Vercel account ran out of usage
  credits.**
- **Netlify** replaced it — same "connect GitHub, auto-deploy on push"
  flow, worked reliably. **Dropped because its free-tier build-minute
  allowance was being consumed quickly by the pace of active development**
  (each push triggers a full rebuild), which isn't representative of
  actual long-term usage but made the free tier impractical to keep
  developing against.
- **Self-hosting on a personal VPS was considered and ruled out** — no VPS
  is available; the available shared hosting (StackCP/20i) has no
  confirmed persistent Node.js process support, only SSH for file/git
  operations. A full systemd + webhook-based self-deploy kit was written
  regardless (`deploy/`) in case suitable hosting becomes available later.
- **Cloudflare Workers (via the OpenNext adapter)** is the current host.
  Chosen for its far more generous free tier (100,000 requests/day vs.
  Netlify's tight build-minute budget) — a better fit for a personal tool
  that should keep working indefinitely without recurring cost or
  migration churn. Verified the built worker is ~1.2 MiB gzipped, well
  under Cloudflare's 3 MiB free-tier size limit.

### Product/UX iterations, roughly in order

1. Core flow: photo → barcode scan → Discogs search → pick a result → add
   to collection.
2. Client-side photo resizing added after phone photos (several MB once
   base64-encoded) were hitting serverless request body size limits.
3. Separate "Use camera" / "Choose photo" buttons added — a single input
   with the `capture` attribute was forcing Android straight into the
   camera app, hiding the gallery option entirely.
4. Expandable per-result detail view added (all images, full tracklist,
   label/catalogue number, genres, country, community stats) — a single
   line of search-result metadata wasn't enough to tell pressings apart.
5. "Already in your collection" detection and highlighting, plus an
   estimated value (median/max, derived from Discogs' `price_suggestions`
   endpoint since Discogs has no direct sold-price median/high stat).
6. Search restricted to vinyl formats only, and an artificial 10-result
   cap that had been added was removed after feedback that it was hiding
   valid matches.
7. Image lightbox (tap a cover image to view full-size) and an "Open in
   Discogs" link next to every Add button.
8. Gemini's OCR text output sanitized (special characters stripped) and
   the Discogs search rebuilt to use dedicated `artist` / `release_title`
   / `label` / `catno` fields instead of one free-text query — prioritizing
   catalogue number as the most precise identifier for a specific pressing.
9. Manual **review stage** added between AI identification and the actual
   Discogs search: the user now sees and can edit exactly which fields
   will be sent, with a live preview of the query, before searching — a
   direct response to automatic searches sometimes being too narrow and
   returning no matches.
10. Persistent "Restart" control added, visible at every stage of the flow.

## Current status

- **Live app:** https://discogs-test.mike-94d.workers.dev/
- **Repository:** https://github.com/mrwuwei777/discogs-test
  (branch: `claude/discogs-photo-collection-app-is1u4y`)
- **Setup / environment variables:** see [`README.md`](../README.md)
- **Self-hosting an own server instead:** see [`deploy/README.md`](../deploy/README.md)

## Possible future work

- Multi-folder support when adding to the collection (currently always
  adds to the default "Uncategorized" folder, ID `1`).
- Editable/removable duplicate-add protection beyond the existing
  "already in your collection" badge.
- Batch mode for photographing several records in one session.
- Revisit self-hosting if VPS or Node-capable hosting becomes available —
  the `deploy/` kit is ready to use as-is.
