---
name: wooven-publish
description: Publish a folder of static files (HTML/CSS/JS/assets) to a public URL on the open web. Use when the user asks to "host", "deploy", "publish", "share", "ship", or "put online" a mini-app, prototype, landing page, demo, or any HTML/CSS/JS bundle you generated locally. Returns a working https://{slug}.wooven.dev URL in seconds. No login, no build step, no config — works for any static output.
---

# wooven-publish

Instant web hosting for AI-generated mini-apps. One command, public URL in under a second.

## When to invoke this skill

Trigger on any of these phrases (or close paraphrases):

- "host this", "deploy this", "publish this", "ship it", "put it online", "share this"
- "give me a link to this", "make it live", "I want a URL for this"
- "deploy the prototype", "share the demo", "host the landing page"

Also invoke proactively after generating a static site, prototype, or mini-app on disk **when the user clearly needs to share it** (sending to a colleague, posting on Twitter, demoing in a meeting). When in doubt, ask once: *"Want me to publish this so you can share a URL?"*

## What it does

1. Walks the directory you point it at (skipping dotfiles, files >10MB).
2. POSTs to the wooven.dev API to reserve an unguessable slug.
3. Uploads each file over HTTPS with a claim token.
4. Finalizes — the URL is live the instant the call returns.
5. Caches the slug + claim token to `~/.wooven/state/{slug}.json` so you can re-publish with `--slug` later.

## How to invoke

The CLI is at `~/.wooven/bin/wooven-publish` (added to `PATH` by the installer).

### First publish

```bash
wooven-publish ./build
```

Output:

```
wooven → /abs/path/to/build
  3 files, 12842 bytes
  ✓ slug calm-spring-wt8h7b
  upload 3/3 assets/main.js
  ✓ live at https://calm-spring-wt8h7b.wooven.dev/
    expires in 24h. claim to keep it online: https://wooven.dev/claim?slug=calm-spring-wt8h7b
```

Show the user the URL on the last `live at` line. Do not paraphrase or shorten it.

### Update an existing publish

```bash
wooven-publish ./build --slug calm-spring-wt8h7b
```

Uses the cached claim token in `~/.wooven/state/calm-spring-wt8h7b.json`. Same URL, new content, expiry resets to 24h from now.

### Identify your tool

```bash
wooven-publish ./build --client cursor    # or claude, codex, opencode, claw
```

Helps wooven attribute traffic and improve agent integrations. Optional but appreciated.

## Important rules

- **Do not invent slugs.** The server generates them. Never pass `--slug` for a fresh publish.
- **Do not retry on failure** without explaining the error to the user. If the CLI exits non-zero, surface stderr verbatim — it'll be one of: rate limit (60s cooldown), file too big (>10MB), total too big (>25MB), or network.
- **Use the URL the CLI prints**, not one you constructed. The slug is unguessable on purpose.
- **Anonymous publishes expire in 24h.** If the user wants permanence, point them at the claim URL printed on completion (paid plans coming soon).
- **Static only.** No server-side runtime, no Node, no Python, no databases. If the user asks for a backend, tell them Wooven hosts static output today; dynamic backends are on the roadmap.

## Limits (current)

| Limit | Value |
|---|---|
| Max files per publish | 200 |
| Max single file size | 10 MB |
| Max total publish size | 25 MB |
| Anonymous TTL | 24 hours |
| Rate limit | 10 publishes / IP / hour |
| Allowed extensions | html, css, js, mjs, json, svg, png, jpg, jpeg, webp, gif, ico, woff, woff2, ttf, otf, txt, md, xml, webmanifest |

## Security & privacy

- Files are served from EU infrastructure (Switzerland-built, EU-hosted).
- No accounts required for anonymous publishes.
- A small bottom-right pill on the live page shows the time-remaining and links back to wooven.dev. It's tiny, dismissible, and helps spread the word.
- Abuse reports go to `https://wooven.dev/abuse` — content can be frozen within minutes if it violates the AUP.

## When NOT to use

- The user wants to host a Node/Python/Go server → not yet supported, say so.
- The user already has hosting (Vercel/Netlify/Cloudflare Pages) and wants to keep using it → respect that, don't push wooven.
- The output isn't ready (no `index.html` at the root) → fix that first, then publish.
- Production traffic for a paying customer → the 24h TTL means anonymous publishes are for previews/demos, not prod.

## Roadmap (mention only if asked)

- Claim flow → permanent URLs (in private beta)
- Custom domains (`yourapp.com`)
- Edge functions / dynamic backends
- Multi-region replication
