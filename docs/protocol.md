# Publish protocol

The publish flow is three HTTP calls against `https://wooven.dev` (or your `WOOVEN_API` override). The first call is anonymous; the next two require the `claimToken` returned by the first.

```
POST /v1/publish                   → { slug, claimToken, ... }
PUT  /v1/publish/:slug/file?path=… → upload one file (raw body)
POST /v1/publish/:slug/finalize    → flip live, return URL
```

Everything is plain HTTPS + JSON + raw bytes. No SDK required — the canonical `bin/wooven-publish` is ~200 lines of bash that uses `curl` and nothing else.

---

## 1. `POST /v1/publish` — reserve a slug

Anonymous. Rate-limited per IP (10 / minute by default). The server picks the slug; clients must not invent one.

### Request

```http
POST /v1/publish HTTP/1.1
Host: wooven.dev
Content-Type: application/json
User-Agent: <your-tool-name>

{
  "client":     "cursor",      // optional, ≤ 40 chars; identifies the calling tool
  "fileCount":  3,             // 1 ≤ N ≤ 200
  "totalBytes": 12842          // 1 ≤ N ≤ 26214400 (25 MB)
}
```

### Response — `200 OK`

```json
{
  "slug":             "calm-spring-wt8h7b",
  "url":              "https://calm-spring-wt8h7b.wooven.dev/",
  "claimToken":       "<opaque bearer token — store securely>",
  "expiresAt":        "2026-04-24T11:14:32.000Z",
  "ttlHours":         24,
  "uploadEndpoint":   "/v1/publish/calm-spring-wt8h7b/file",
  "finalizeEndpoint": "/v1/publish/calm-spring-wt8h7b/finalize",
  "limits": {
    "maxFiles":      200,
    "maxFileBytes":  10485760,
    "maxTotalBytes": 26214400
  }
}
```

The `claimToken` authorises every subsequent call for this slug — uploads, finalize, re-publish, delete. Treat it like a password. The canonical CLI persists it to `~/.wooven/state/{slug}.json` (mode 600).

### Errors

| Status | `error`              | Cause                                   |
| ------ | -------------------- | --------------------------------------- |
| 400    | `too_many_files`     | `fileCount` > 200                       |
| 400    | `publish_too_large`  | `totalBytes` > 25 MB                    |
| 429    | `rate_limited`       | Too many requests from this IP. Honour `Retry-After`. |
| 500    | `slug_collision`     | Server failed to mint a unique slug after retries — try again. |
| 503    | `db_required`        | Backend storage unavailable.            |

---

## 2. `PUT /v1/publish/:slug/file` — upload one file

Authenticated. One call per file. Body is raw bytes. Path goes in the query string (URL-encoded).

### Request

```http
PUT /v1/publish/calm-spring-wt8h7b/file?path=assets%2Fmain.js HTTP/1.1
Host: wooven.dev
Authorization: Bearer <claimToken>
Content-Type: application/javascript; charset=utf-8

<raw bytes>
```

The `path` query parameter is the file's relative path inside the publish (e.g. `index.html`, `assets/main.js`). Max length 256. Server rejects path traversal and disallowed extensions.

### Response — `200 OK`

```json
{ "ok": true, "bytes": 1842, "path": "assets/main.js" }
```

### Errors

| Status | `error`               | Cause                                  |
| ------ | --------------------- | -------------------------------------- |
| 400    | `invalid_path`        | Missing/empty/too-long path, traversal, disallowed extension |
| 400    | `empty_body`          | Zero-byte body                         |
| 401    | `missing_claim_token` | No `Authorization: Bearer …` header    |
| 403    | `invalid_claim_token` | Token doesn't match the slug           |
| 404    | `not_found`           | Slug doesn't exist (or expired)        |
| 503    | `db_required`         | Backend storage unavailable            |

### Allowed extensions

`html`, `htm`, `css`, `js`, `mjs`, `json`, `svg`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `ico`, `woff`, `woff2`, `ttf`, `otf`, `txt`, `md`, `xml`, `webmanifest`.

### Per-file size cap

10 MB. Larger files are rejected.

---

## 3. `POST /v1/publish/:slug/finalize` — flip it live

Authenticated. After the last upload. The URL goes live the moment this call returns.

### Request

```http
POST /v1/publish/calm-spring-wt8h7b/finalize HTTP/1.1
Host: wooven.dev
Authorization: Bearer <claimToken>
```

No body.

### Response — `200 OK`

```json
{
  "ok":         true,
  "slug":       "calm-spring-wt8h7b",
  "url":        "https://calm-spring-wt8h7b.wooven.dev/",
  "expiresAt":  "2026-04-24T11:14:32.000Z"
}
```

### Errors

| Status | `error`                | Cause                                     |
| ------ | ---------------------- | ----------------------------------------- |
| 400    | `no_files_uploaded`    | Finalize called before any successful upload |
| 401    | `missing_claim_token`  | No bearer header                          |
| 403    | `invalid_claim_token`  | Wrong token for this slug                 |
| 404    | `not_found`            | Slug doesn't exist (or expired)           |
| 500    | `finalize_failed`      | Server-side failure during atomic rename — safe to retry |

---

## 4. `DELETE /v1/publish/:slug` — take down

Authenticated. Removes the publish and its files.

### Request

```http
DELETE /v1/publish/calm-spring-wt8h7b HTTP/1.1
Host: wooven.dev
Authorization: Bearer <claimToken>
```

### Response — `200 OK`

```json
{ "ok": true, "slug": "calm-spring-wt8h7b" }
```

Same auth errors as finalize. The canonical CLI doesn't expose this directly (yet); call it with `curl` if you need it.

---

## End-to-end with curl

```bash
API="https://wooven.dev"

# 1. Reserve a slug
RESP=$(curl -fsSL -X POST "$API/v1/publish/" \
  -H "Content-Type: application/json" \
  -d '{"client":"docs","fileCount":1,"totalBytes":42}')

SLUG=$(echo "$RESP" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
TOKEN=$(echo "$RESP" | sed -n 's/.*"claimToken":"\([^"]*\)".*/\1/p')

# 2. Upload one file
echo '<h1>hi</h1>' | curl -fsSL -X PUT \
  "$API/v1/publish/$SLUG/file?path=index.html" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @-

# 3. Flip it live
curl -fsSL -X POST "$API/v1/publish/$SLUG/finalize" \
  -H "Authorization: Bearer $TOKEN"

echo "https://$SLUG.wooven.dev/"
```
