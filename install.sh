#!/usr/bin/env bash
# wooven skill installer — instant web hosting for AI coding agents
#
# Installs the canonical skill + CLI to:
#   ~/.wooven/SKILL.md          (the agent contract)
#   ~/.wooven/bin/wooven-publish (the CLI)
#   ~/.wooven/state/             (per-slug claim cache, mode 700)
#
# Then symlinks SKILL.md into every detected agent skill directory:
#   ~/.claude/skills/wooven/SKILL.md
#   ~/.cursor/skills/wooven/SKILL.md
#   ~/.codex/skills/wooven/SKILL.md
#
# Re-running is safe and idempotent — symlinks and CLI are atomically replaced.
#
# Usage:
#   curl -fsSL https://wooven.dev/skill/install.sh | bash

set -euo pipefail

WOOVEN_HOME="${WOOVEN_HOME:-${HOME}/.wooven}"
BIN_DIR="${WOOVEN_HOME}/bin"
STATE_DIR="${WOOVEN_HOME}/state"
SKILL_FILE="${WOOVEN_HOME}/SKILL.md"
CLI_FILE="${BIN_DIR}/wooven-publish"
REPO_BASE="${WOOVEN_REPO_BASE:-https://wooven.dev/skill}"

# ────────── Helpers ──────────

c_red()   { printf '\033[0;31m%s\033[0m' "$*"; }
c_green() { printf '\033[0;32m%s\033[0m' "$*"; }
c_dim()   { printf '\033[2m%s\033[0m' "$*"; }
c_bold()  { printf '\033[1m%s\033[0m' "$*"; }

die() { echo "$(c_red error:) $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "requires '$1' (install it and retry)"
}

atomic_download() {
  local url="$1" dest="$2" tmp
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"
    die "download failed: $url"
  fi
  mv -f "$tmp" "$dest"
}

# Atomically (re)create a symlink target → src.
relink() {
  local src="$1" target="$2"
  mkdir -p "$(dirname "$target")"
  rm -f "$target"
  ln -s "$src" "$target"
}

# ────────── Pre-flight ──────────

need_cmd curl
need_cmd uname
need_cmd mktemp
need_cmd ln

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) die "unsupported OS: $(uname -s) (Wooven supports macOS and Linux today)" ;;
esac

echo "$(c_bold "Installing wooven skill") $(c_dim "→") $WOOVEN_HOME"

# ────────── 1. Canonical install ──────────

mkdir -p "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

atomic_download "${REPO_BASE}/SKILL.md"   "$SKILL_FILE"
atomic_download "${REPO_BASE}/publish.sh" "$CLI_FILE"
chmod +x "$CLI_FILE"

echo "  $(c_green "✓") canonical files in $WOOVEN_HOME"

# ────────── 2. Symlink into detected agent dirs ──────────

declare -a DETECTED=()

link_for_agent() {
  local agent_name="$1" agent_root="$2"
  if [[ -d "$agent_root" ]]; then
    local target="${agent_root}/skills/wooven/SKILL.md"
    relink "$SKILL_FILE" "$target"
    DETECTED+=("$agent_name → $target")
  fi
}

link_for_agent "claude"   "${HOME}/.claude"
link_for_agent "cursor"   "${HOME}/.cursor"
link_for_agent "codex"    "${HOME}/.codex"
link_for_agent "opencode" "${HOME}/.opencode"

if [[ ${#DETECTED[@]} -eq 0 ]]; then
  echo "  $(c_dim "no agent dirs detected (~/.claude, ~/.cursor, ~/.codex, ~/.opencode)")"
  echo "  $(c_dim "skill is ready — re-run after installing your agent")"
else
  echo "  $(c_green "✓") linked to ${#DETECTED[@]} agent$([[ ${#DETECTED[@]} -eq 1 ]] || echo s):"
  for entry in "${DETECTED[@]}"; do
    echo "    $(c_dim "·") $entry"
  done
fi

# ────────── 3. PATH detection ──────────

on_path=false
case ":${PATH}:" in
  *":${BIN_DIR}:"*) on_path=true ;;
esac

if $on_path; then
  echo "  $(c_green "✓") $BIN_DIR already on PATH"
else
  # Pick the most likely shell rc file without modifying it.
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh)  rc_hint="${HOME}/.zshrc" ;;
    bash) rc_hint="${HOME}/.bashrc" ;;
    fish) rc_hint="${HOME}/.config/fish/config.fish" ;;
    *)    rc_hint="your shell rc file" ;;
  esac

  cat <<EOF

  $(c_bold "Add to your PATH") $(c_dim "(once, then restart your shell):")

    echo 'export PATH="\$HOME/.wooven/bin:\$PATH"' >> $rc_hint

EOF
fi

# ────────── 4. Done ──────────

cat <<EOF

$(c_green "wooven skill installed.") Try it:

  $(c_bold "wooven-publish ./your-folder")

Restart your AI coding tool (Claude Code, Cursor, Codex) so it picks up the new skill.

Docs: https://wooven.dev/docs/agents
EOF
