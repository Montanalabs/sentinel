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

err() { printf 'error: %s\n' "$1" >&2; exit 1; }

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

printf 'Installing sentinel (%s) for %s-%s...\n' "$VERSION" "$os" "$arch"
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
if ! curl -fsSL "$url" -o "$tmp"; then
  err "download failed: $url (is there a release with the $asset asset?)"
fi
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/sentinel"

printf '\nInstalled to %s/sentinel\n' "$INSTALL_DIR"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\nAdd it to your PATH:\n  export PATH="%s:$PATH"\n' "$INSTALL_DIR" ;;
esac
printf '\nRun:  sentinel --help\n'
