#!/usr/bin/env bash
# Sentinel installer for macOS, Linux, and WSL.
#   curl -fsSL https://raw.githubusercontent.com/montanalabs/sentinel/main/scripts/install.sh | bash
#
# Downloads the standalone `sentinel` binary for your platform from GitHub Releases and installs it
# to ~/.local/bin (override with SENTINEL_INSTALL_DIR). No Node.js required.
set -euo pipefail

REPO="${SENTINEL_REPO:-montanalabs/sentinel}"
VERSION="${SENTINEL_VERSION:-latest}"
INSTALL_DIR="${SENTINEL_INSTALL_DIR:-$HOME/.local/bin}"

# Color only when stdout is a terminal (respects the NO_COLOR convention).
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=''; dim=''; green=''; red=''; reset=''
fi

err() { printf '%serror:%s %s\n' "$red$bold" "$reset" "$1" >&2; exit 1; }

# Detect platform → release asset name.
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) err "unsupported OS: $os (use the npm install instead: npm i -g sentinel)" ;;
esac
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) err "unsupported architecture: $arch" ;;
esac
asset="sentinel-${os}-${arch}"

# Resolve the download URL.
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

printf '\n%sInstalling Sentinel%s for %s-%s\n\n' "$bold" "$reset" "$os" "$arch"
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
if ! curl -fSL --progress-bar "$url" -o "$tmp"; then
  err "download failed: $url (is there a release with the $asset asset?)"
fi
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/sentinel"

# Ask the freshly-installed binary its version, so the success line shows the real version.
ver="$("$INSTALL_DIR/sentinel" --version 2>/dev/null || true)"
printf '\n%s✓ Installed%s Sentinel%s → %s/sentinel\n' "$green$bold" "$reset" "${ver:+ v$ver}" "$INSTALL_DIR"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\n%sAdd to your PATH:%s  export PATH="%s:$PATH"\n' "$dim" "$reset" "$INSTALL_DIR" ;;
esac
printf '\n%sGet started:%s\n' "$bold" "$reset"
printf '  %ssentinel init%s    scaffold a gate\n' "$bold" "$reset"
printf '  %ssentinel --help%s  all commands\n' "$bold" "$reset"
printf '\n%sDocs: https://github.com/montanalabs/sentinel%s\n' "$dim" "$reset"
