# Discogs Photo Collector

Photograph a record → find it on Discogs → add it straight to your collection.

## How it works

1. Open the app on your phone and take (or upload) a photo of a record's cover, label, or barcode.
2. The app first tries to read a **barcode** from the photo in your browser (via ZXing) and looks it up directly on Discogs.
3. If no barcode is found, the photo is sent to **Google Gemini** (free tier) to read the artist/title off the cover, which is then used to search Discogs.
4. You pick the correct release from the search results and tap **Add** — it's added to your Discogs collection via the Discogs API.

Everything runs as a small Next.js app: a mobile-friendly web page plus a couple of API routes that talk to Discogs and Gemini. Your Discogs token and Gemini API key stay server-side and are never sent to the browser.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   - `DISCOGS_TOKEN` — generate a personal access token at https://www.discogs.com/settings/developers
   - `DISCOGS_USERNAME` — optional; auto-detected from the token if left blank
   - `GEMINI_API_KEY` — free, from https://aistudio.google.com/apikey (no card required at the free-tier request volumes this app uses)

3. Run it locally:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. To use the camera from your phone, deploy it (e.g. to [Netlify](https://netlify.com)) or expose your dev server over your LAN/a tunnel.

## Deploying (Netlify)

1. Go to https://app.netlify.com → **Add new site → Import an existing project**.
2. Connect GitHub and pick the `discogs-test` repo, branch `claude/discogs-photo-collection-app-is1u4y`.
3. Netlify auto-detects Next.js via `netlify.toml` (already in this repo) — no build settings to change.
4. Before the first deploy (or right after, then redeploy), add the environment variables under **Site configuration → Environment variables**:
   - `DISCOGS_TOKEN`
   - `DISCOGS_USERNAME` (optional)
   - `GEMINI_API_KEY`
5. Deploy. Netlify auto-redeploys on every push to the connected branch from then on.

Any other Next.js host works too — just set the same three environment variables and don't commit `.env.local`.

## Notes

- New releases are added to your default "Uncategorized" collection folder (folder ID `1`). You can move them into other folders from Discogs itself.
- Discogs search isn't always perfect for obscure or bootleg pressings — the app shows multiple candidate results so you can pick the right one, or take another, clearer photo.
- This is built for personal/single-user use (one Discogs token = one account). Multi-user support would need the full Discogs OAuth flow instead of a personal token.
