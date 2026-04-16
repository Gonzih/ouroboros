#!/usr/bin/env bash
# install.sh — install Ouroboros meta-agent as a background service
# Supports macOS (launchd) and Linux (systemd user)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$REPO_ROOT/.env"

# ── Check prerequisites ──────────────────────────────────────────────────────

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required. Install from https://nodejs.org" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm is required. Run: npm install -g pnpm" >&2; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: Claude Code CLI is required. Install from https://claude.ai/code" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || echo "Warning: psql not found. Ensure DATABASE_URL points to a running Postgres."

# ── Bootstrap .env ───────────────────────────────────────────────────────────

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$REPO_ROOT/.env.example" ]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    echo "Created .env from .env.example — edit it before starting services"
    echo "Required: DATABASE_URL, CLAUDE_CODE_OAUTH_TOKEN, OURO_REPO_ROOT"
    exit 0
  fi
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill in values." >&2
  exit 1
fi

# ── Install and build ────────────────────────────────────────────────────────

echo "Installing dependencies..."
cd "$REPO_ROOT"
pnpm install
echo "Building packages..."
pnpm build

# Read key vars from .env (ignoring comments and blank lines)
_get_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

DATABASE_URL="$(_get_env DATABASE_URL)"
CLAUDE_CODE_OAUTH_TOKEN="$(_get_env CLAUDE_CODE_OAUTH_TOKEN)"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set in .env" >&2
  exit 1
fi
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN is not set in .env" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
META_AGENT_MAIN="$REPO_ROOT/packages/meta-agent/dist/index.js"

# ── macOS — launchd ──────────────────────────────────────────────────────────

install_macos() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/com.ouroboros.meta-agent.plist"

  mkdir -p "$plist_dir"

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ouroboros.meta-agent</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${META_AGENT_MAIN}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>DATABASE_URL</key>
    <string>${DATABASE_URL}</string>
    <key>CLAUDE_CODE_OAUTH_TOKEN</key>
    <string>${CLAUDE_CODE_OAUTH_TOKEN}</string>
    <key>OURO_REPO_ROOT</key>
    <string>${REPO_ROOT}</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${REPO_ROOT}/meta-agent.log</string>

  <key>StandardErrorPath</key>
  <string>${REPO_ROOT}/meta-agent.log</string>
</dict>
</plist>
PLIST

  launchctl unload "$plist_path" 2>/dev/null || true
  launchctl load -w "$plist_path"
  echo "Installed: $plist_path"
  echo "Service loaded via launchd. Check meta-agent.log for output."
}

# ── Linux — systemd user ─────────────────────────────────────────────────────

install_linux() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="$unit_dir/ouroboros-meta-agent.service"

  mkdir -p "$unit_dir"

  cat > "$unit_path" <<UNIT
[Unit]
Description=Ouroboros Meta-Agent
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${META_AGENT_MAIN}
WorkingDirectory=${REPO_ROOT}
Restart=always
RestartSec=5

Environment=DATABASE_URL=${DATABASE_URL}
Environment=CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}
Environment=OURO_REPO_ROOT=${REPO_ROOT}

StandardOutput=append:${REPO_ROOT}/meta-agent.log
StandardError=append:${REPO_ROOT}/meta-agent.log

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now ouroboros-meta-agent.service
  echo "Installed: $unit_path"
  echo "Service enabled via systemd user. Run: journalctl --user -u ouroboros-meta-agent -f"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

case "$(uname -s)" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)
    echo "ERROR: Unsupported platform: $(uname -s)" >&2
    echo "For Windows, run scripts/install.ps1 in PowerShell." >&2
    exit 1
    ;;
esac
