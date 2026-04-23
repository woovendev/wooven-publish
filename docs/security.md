# Security & limits

What you're trusting when you publish to `*.wooven.dev`, and what we won't accept.

## Anonymous TTL

Anonymous publishes live for **24 hours** from finalize time. After that the files are deleted and the subdomain returns 404. There is no automatic extension — re-publish (with the cached claim token) to reset the clock.

To keep a publish online longer, follow the claim URL printed by the CLI:

```
expires in 24h. claim to keep it online: https://wooven.dev/claim?slug=<slug>
```

Permanent URLs are in private beta.

## Hard limits

| Limit                    | Value             |
| ------------------------ | ----------------- |
| Max files per publish    | 200               |
| Max single file size     | 10 MB             |
| Max total publish size   | 25 MB             |
| Anonymous TTL            | 24 hours          |
| Rate limit (publish API) | 10 / IP / minute  |

Hitting any of these returns `400` (size/count) or `429` (rate). The CLI surfaces the error verbatim — don't retry without explaining.

## Allowed file extensions

Only static web assets. Anything else is rejected at upload time.

`html`, `htm`, `css`, `js`, `mjs`, `json`, `svg`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `ico`, `woff`, `woff2`, `ttf`, `otf`, `txt`, `md`, `xml`, `webmanifest`

No executables. No archives. No `.env`, no shell scripts, no Wasm binaries (yet).

## What gets served, how

- HTTPS only. TLS terminated upstream; HTTP redirects to HTTPS.
- `X-Content-Type-Options: nosniff` on every response — your `script.js` will not be sniffed as HTML.
- Each publish lives at its own subdomain (`{slug}.wooven.dev`). No path-based multi-tenancy, no shared cookie scope.
- Slugs are server-generated and unguessable: `{adjective}-{noun}-{6-char-hash}` ≈ 10⁹ combinations.

## What you're trusting

- **Hosting region:** EU (Switzerland-built, EU-hosted).
- **No request logs are sold or shared.** Per-IP rate limit counters are kept in process memory only.
- **Claim tokens are HMAC-bound to the slug** and stored hashed at rest. The plaintext token is only returned once, in the response to `POST /v1/publish`. Lose it and you lose update/delete rights for that publish (until TTL expires).

## Bottom-right pill

Every published page gets a small, dismissible pill in the bottom-right corner showing the time-remaining and a link back to `wooven.dev`. It's tiny and unobtrusive — and it's how anonymous publishes stay free. If you want it gone, use a paid plan (coming soon).

## Abuse & takedowns

Report content that violates the AUP at:

> **https://wooven.dev/abuse**

Phishing, malware, CSAM, and impersonation get frozen within minutes. We'd rather catch one false positive than miss one real one.

## What is NOT on this list

This is the user-facing security posture. Internal threat models, infrastructure hardening, and incident postmortems live in our private docs and are not part of the public CLI's contract.
