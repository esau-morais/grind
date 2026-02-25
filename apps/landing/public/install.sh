#!/usr/bin/env bash
set -euo pipefail

GRIND_INSTALL_DIR="${GRIND_INSTALL_DIR:-$HOME/.grind/bin}"
GRIND_VERSION="${GRIND_VERSION:-}"
REPO="esau-morais/grind"
NO_INIT=0

for arg in "$@"; do
  case "$arg" in
    --no-init) NO_INIT=1 ;;
  esac
done

# ── Platform detection ────────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) OS_NAME="darwin" ;;
  Linux)  OS_NAME="linux" ;;
  *)
    echo "error: unsupported OS: $OS" >&2
    echo "  Install via npm instead: npm install -g grindxp" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)          ARCH_NAME="x64" ;;
  arm64|aarch64)   ARCH_NAME="arm64" ;;
  *)
    echo "error: unsupported architecture: $ARCH" >&2
    echo "  Install via npm instead: npm install -g grindxp" >&2
    exit 1
    ;;
esac

BINARY_NAME="grind-${OS_NAME}-${ARCH_NAME}"

# ── Resolve version ───────────────────────────────────────────────────────────

if [[ -z "$GRIND_VERSION" ]]; then
  if command -v curl >/dev/null 2>&1; then
    GRIND_VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' \
      | sed 's/.*"tag_name": *"\(.*\)".*/\1/' \
      | tr -d 'v')"
  fi
  if [[ -z "$GRIND_VERSION" ]]; then
    echo "error: could not resolve latest Grind version" >&2
    echo "  Set GRIND_VERSION=x.y.z to install a specific version" >&2
    exit 1
  fi
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${GRIND_VERSION}/${BINARY_NAME}"

# ── Download & install ────────────────────────────────────────────────────────

echo "Installing grind v${GRIND_VERSION} (${OS_NAME}/${ARCH_NAME})..."

mkdir -p "$GRIND_INSTALL_DIR"
DEST="${GRIND_INSTALL_DIR}/grind"

curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$DEST"
chmod +x "$DEST"

# ── PATH setup ────────────────────────────────────────────────────────────────

add_to_path() {
  local rc_file="$1"
  local line='export PATH="$HOME/.grind/bin:$PATH"'
  if [[ -f "$rc_file" ]] && ! grep -qF '.grind/bin' "$rc_file" 2>/dev/null; then
    echo "" >> "$rc_file"
    echo "# Added by Grind installer" >> "$rc_file"
    echo "$line" >> "$rc_file"
    echo "  Added to $rc_file"
  fi
}

if [[ ":$PATH:" != *":${GRIND_INSTALL_DIR}:"* ]]; then
  add_to_path "$HOME/.zshrc"
  add_to_path "$HOME/.bashrc"
  add_to_path "$HOME/.profile"
  export PATH="${GRIND_INSTALL_DIR}:$PATH"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "grind v${GRIND_VERSION} installed to ${DEST}"

if [[ "$NO_INIT" -eq 0 ]]; then
  echo ""
  "$DEST" init
fi
