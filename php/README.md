# PHP port — self-hosted on shared hosting

A dependency-free PHP + vanilla-JS port of the app, running at
`hypemachine.co.uk/discogs/`. Functionally equivalent to the Next.js version:
same identification pipeline, same Discogs queries, same UI (the stylesheet is
shared verbatim).

## Why this exists

The Next.js app cannot run on the target host. The 20i/StackCP shared hosting
behind hypemachine.co.uk has **no Node.js runtime**, and one cannot be installed:

- No `node`/`npm` on the SSH node (`ssh-node-gb.lhr.stackcp.net`) or the web
  node (`web185.lhr.stackcp.net`).
- `/home/sites/34a` is an NFS mount with `noexec`, so a self-installed Node
  binary cannot execute either — copying `/bin/echo` into `$HOME` and running it
  gives `Permission denied`.

What the host *does* offer is Apache + PHP 8.0.30 (fpm-fcgi) with `curl`, `gd`,
`imagick` and `sqlite3`, a 128 MB POST limit, and unrestricted outbound HTTPS.
Every server-side thing this app does is an authenticated HTTP call, so the port
is straightforward.

## Layout

| Path | Replaces |
|---|---|
| `index.php` | `app/layout.tsx` + `app/page.tsx` |
| `assets/app.js` | `components/RecordCapture.tsx` + `components/ResultCard.tsx` |
| `assets/styles.css` | `app/globals.css` (copied verbatim) |
| `assets/zxing.min.js` | `@zxing/browser` (vendored UMD build of `@zxing/library@0.23.0`) |
| `lib/discogs.php` | `lib/discogs.ts` |
| `lib/gemini.php` | `lib/gemini.ts` (`@google/genai` → direct v1beta REST) |
| `api/*.php` | the seven routes under `app/api/` |
| `lib/bootstrap.php` | config loading, auth gate, cache (no Next.js equivalent) |

`api/health.php` has no counterpart in the original. It reports config state and
checks both upstream APIs *from the web node*, which matters because the SSH box
is a different machine and cannot reach the web server.

## Deliberate differences

**Concurrency.** `Promise.all` over N releases became `curl_multi` in windows of
5. Sequential curl would make a 20-result search painfully slow; unbounded
concurrency would breach the Discogs limit of 60 requests/minute. Eight
ownership lookups complete in ~0.9s.

**Caching.** Release details (7 days) and price suggestions (24 hours) are
cached to disk in `~/discogs-cache`. Ownership is never cached, so a record
added seconds ago shows as owned immediately. Failed lookups are not cached.

**Auth.** The app writes to a real collection with a single personal token and
sits on a public domain, so it is gated behind HTTP Basic auth. This is enforced
in PHP rather than Apache `AuthUserFile`, so it does not depend on what
`AllowOverride` the shared host grants.

**No build step.** React/JSX/TypeScript are replaced with direct DOM
construction. Nodes are built with `createElement`, never interpolated into
`innerHTML`, because every string rendered (titles, notes, tracklists) is
third-party data from Discogs.

## Install

1. Copy the contents of this directory to `~/public_html/discogs/`.
2. Copy `config.sample.php` to `~/discogs-config.php` — **outside** the web root
   — and fill in the Discogs token and Gemini key. `chmod 600` it.
3. Generate the auth password hash:
   `php -r 'echo password_hash("your-password", PASSWORD_BCRYPT), "\n";'`
4. Confirm with `curl -u user:pass https://your-host/discogs/api/health.php`.

Lint against the server's PHP, not a workstation's — 8.1+ syntax passes a modern
local lint and fatals on PHP 8.0:

```bash
ssh hypemachine 'php -l ~/public_html/discogs/lib/discogs.php'
```

## Known limitation

The estimated-value feature is inert until the Discogs account has seller
settings filled in; until then `/marketplace/price_suggestions/` returns
`404 {"message":"You must fill out your seller settings first."}`. This affects
the Cloudflare deployment identically — both treat prices as non-critical and
swallow the error, so it fails silently rather than visibly.
