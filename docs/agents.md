# Per-agent setup

`install.sh` probes for known AI coding-agent home directories and symlinks the canonical `SKILL.md` into each one it finds. Re-running the installer is idempotent — symlinks are atomically replaced.

## Detected agents

| Agent          | Detected directory   | Symlink target                          |
| -------------- | -------------------- | --------------------------------------- |
| Claude Code    | `~/.claude`          | `~/.claude/skills/wooven/SKILL.md`      |
| Cursor         | `~/.cursor`          | `~/.cursor/skills/wooven/SKILL.md`      |
| Codex          | `~/.codex`           | `~/.codex/skills/wooven/SKILL.md`       |
| OpenCode       | `~/.opencode`        | `~/.opencode/skills/wooven/SKILL.md`    |

Each symlink points back to the single source of truth at `~/.wooven/SKILL.md`. Update once, every agent sees it.

If none are detected the installer prints a notice and exits 0 — re-run after installing your agent.

## Layout after install

```
~/.wooven/
├── SKILL.md            # canonical skill (source of truth for symlinks)
├── bin/
│   └── wooven-publish  # the CLI
└── state/              # mode 700; per-slug claim cache as {slug}.json (mode 600)
```

## PATH

The installer does not modify your shell rc files. If `~/.wooven/bin` is not on your `PATH`, it prints the one-liner you need:

```bash
echo 'export PATH="$HOME/.wooven/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc / ~/.config/fish/config.fish
```

## Environment overrides

| Variable            | Default                       | Purpose                                                                     |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `WOOVEN_HOME`       | `~/.wooven`                   | Where install.sh puts everything                                            |
| `WOOVEN_REPO_BASE`  | `https://wooven.dev/skill`    | Source for `SKILL.md` + `publish.sh` (use `file://...` for offline installs) |
| `WOOVEN_API`        | `https://wooven.dev`          | API base used by `wooven-publish` (override for self-hosted)                |
| `WOOVEN_STATE_DIR`  | `$WOOVEN_HOME/state`          | Where claim tokens are cached                                               |
| `WOOVEN_CLIENT`     | `cli`                         | Default `--client` identifier                                               |

## Adding a new agent

If your agent reads skills from `~/.youragent/skills/<name>/SKILL.md`, open an issue or PR — adding it to `install.sh` is a one-line change.

## Manual install (no agent)

You can use the CLI without any agent integration:

```bash
curl -fsSL https://wooven.dev/skill/install.sh | bash
~/.wooven/bin/wooven-publish ./my-folder
```
