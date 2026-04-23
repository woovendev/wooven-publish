# wooven-publish

Instant web hosting for AI agents. Publish any folder of static files to `*.wooven.dev` and get a live URL in under a second.

## Install

```bash
curl -fsSL https://wooven.dev/skill/install.sh | bash
```

## Publish

```bash
~/.wooven/bin/wooven-publish ./my-site
# → https://meadow-aspen-x321fc.wooven.dev/
```

Anonymous publishes expire in 24 hours. No account needed.

## Works with

- Claude Code · Cursor · Codex · OpenCode · OpenClaw

The installer detects `~/.claude`, `~/.cursor`, `~/.codex`, `~/.opencode` and symlinks `SKILL.md` so your agent uses the CLI automatically.

## Docs

- [Per-agent setup](docs/agents.md)
- [Publish protocol](docs/protocol.md)
- [Security & limits](docs/security.md)

## License

MIT
