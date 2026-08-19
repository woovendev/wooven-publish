# Lattice

A local-first block workspace: nested pages, a live markdown block editor, databases with multiple views, and a thin PM layer (personas, blockers, recurrence, workload, a tiny report). One browser, one workspace. No accounts.

Modules will not run from `file://`.

## Run locally

```bash
cd examples/lattice && python3 -m http.server 8766
open http://localhost:8766
```

## Publish (wooven-publish)

From the **repository root** (never publish the whole repo — only this folder):

```bash
chmod +x bin/wooven-publish   # once, if unzip dropped the bit
./bin/wooven-publish ./examples/lattice --client cursor
```

If the installer is on your `PATH`:

```bash
wooven-publish ./examples/lattice --client cursor
```

The CLI prints `live at https://{slug}.wooven.dev/` — that URL is the site. Anonymous publishes expire in 24 hours; use the printed claim URL to keep them. Re-publish with `--slug <slug>` only if a claim token is already cached.

`index.html` must stay at this folder’s root. Only static files (`html`, `css`, `js`, `md`, …). Relative ES module imports (`./app.js`, `./store.js`) are required so hosting with `X-Content-Type-Options: nosniff` still boots.

Live URL (filled after publish): _pending first publish_

`localhost:8766` and `https://{slug}.wooven.dev` are different origins, so they have **separate** `localStorage` workspaces. First visit to a new origin seeds the Studio demo.

## Storage

- Key: `lattice:v1`
- One JSON document `{ schemaVersion, workspace }`
- Autosave ~200ms after each change
- Export JSON from the sidebar; CSV from a database toolbar
- Import JSON: Replace workspace / Merge pages
- Import CSV: open a database first; columns map to properties by name (`Title` → page title). Unknown columns are skipped.

## Ontology

```
Workspace
  personas[]   hats you assign work to (no login)
  pages[]      docs + databases; rows are pages with parentPageId = database
  blocks[]     flat map; pages hold ordered childBlockIds
  comments[]   threaded on any block
  databases[]  schema + views
  activity[]   last ~100 local events
```

Blocking is stored once on the source page; **blockedBy** is derived. Cycles are rejected. Child-task rollup is a hint (`2/5`), never an auto-close.

Personas: create/edit/archive in the sidebar. **Acting as** is persisted on the workspace and attributes comments + activity.

## Keyboard

| Shortcut | Action |
|---|---|
| `/` | Slash insert (block types, page, database, image) |
| Enter | New block after |
| Shift+Enter | Newline inside block |
| Tab / Shift+Tab | Indent / outdent lists |
| Backspace at start | Merge or demote to paragraph |
| j / k or arrows | Move between blocks |
| ⌘/Ctrl+Shift+↑↓ | Reorder block |
| ⌘/Ctrl+K | Jump to page / persona / task |
| ⌘/Ctrl+Z | Undo last workspace change (not while typing in a block) |
| `[[Title]]` | Wikilink (creates the page if missing) |
| `@handle` | Mention a persona |

Markdown prefixes convert on space/enter: `#` `##` `###`, `-`/`*`, `1.`, `- [ ]`, `>`, ` ``` `, `---`. Inline: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[text](https://url)`.

## Files

Each file has one job: `model.js` ontology, `store.js` persistence, `seed.js` Studio demo, `editor.js` blocks, `views.js` databases, `work.js` PM, `app.js` boot/shell.
