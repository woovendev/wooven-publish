# Changelog

## v0.1.1 — index.html UX

- CLI warns when the folder has no root `index.html` (site root would 404; only full paths work)
- If exactly one root-level `.html`/`.htm` exists, the warning suggests renaming it to `index.html`
- `SKILL.md`: explicit rule that `index.html` at the root is required for `https://{slug}.wooven.dev/`

## v0.1.0 — initial public release

- `install.sh` one-line installer (curl | bash)
- `bin/wooven-publish` CLI: walk a folder, publish to `*.wooven.dev`, get a live URL
- `skill/SKILL.md` agent contract — auto-symlinked into Claude Code, Cursor, Codex, OpenCode
- Docs: per-agent setup, publish protocol (3 endpoints), security & limits
- Hello-world example
- Shellcheck CI on push
