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

## Run it Locally from Terminal

If you **cloned** or **downloaded the repo** (zip from GitHub), you can publish **without** running `install.sh`. Use the bundled CLI in `bin/`. Requires `curl` and `find` (macOS or Linux).

1. `cd` into the repo root. GitHub’s zip is usually `wooven-publish-main/`; a `git clone` is usually `wooven-publish/`.
2. Make the CLI executable (once — some unzip tools drop the execute bit):

   ```bash
   chmod +x bin/wooven-publish
   ```

3. Publish a folder **relative to that repo root**, e.g. the bundled demo:

   ```bash
   ./bin/wooven-publish ./examples/hello-world
   ```

   The script prints a line like `✓ live at https://….wooven.dev/` — that URL is your site.

**Optional**

- Identify the client: `./bin/wooven-publish ./examples/hello-world --client cursor`
- Another API base: `WOOVEN_API="https://your-api.example" ./bin/wooven-publish ./my-site`
- Claim cache directory (default `~/.wooven/state`): `WOOVEN_STATE_DIR="$PWD/.wooven-state" ./bin/wooven-publish ./my-site`

`install.sh` is still what you want for `~/.wooven` on your PATH and for symlinking `SKILL.md` into agent directories — use the steps above when you only need to ship a folder from disk.

## Works with

- Claude Code · Cursor · Codex · OpenCode · OpenClaw

The installer detects `~/.claude`, `~/.cursor`, `~/.codex`, `~/.opencode` and symlinks `SKILL.md` so your agent uses the CLI automatically.

## Docs

- [Per-agent setup](docs/agents.md)
- [Publish protocol](docs/protocol.md)
- [Security & limits](docs/security.md)

## License

MIT
