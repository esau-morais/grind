#!/usr/bin/env bash
set -euo pipefail

GRIND_INSTALL_DIR="${GRIND_INSTALL_DIR:-$HOME/.grind/bin}"
GRIND_VERSION="${GRIND_VERSION:-}"
REPO="esau-morais/grind"
NO_INIT=0
PRIMARY_CMD="grindxp"
ALIAS_CMD="grind"

for arg in "$@"; do
  case "$arg" in
    --no-init)
      NO_INIT=1
      ;;
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
ARCHIVE_NAME="${BINARY_NAME}.tar.gz"

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

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${GRIND_VERSION}/${ARCHIVE_NAME}"
LEGACY_DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${GRIND_VERSION}/${BINARY_NAME}"

# ── Download & install ────────────────────────────────────────────────────────

echo "Installing grindxp v${GRIND_VERSION} (${OS_NAME}/${ARCH_NAME})..."

mkdir -p "$GRIND_INSTALL_DIR"
DEST="${GRIND_INSTALL_DIR}/${PRIMARY_CMD}"
ALIAS_DEST="${GRIND_INSTALL_DIR}/${ALIAS_CMD}"
DRIZZLE_DEST="${GRIND_INSTALL_DIR}/drizzle"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE_PATH="${TMP_DIR}/${ARCHIVE_NAME}"

if curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"; then
  if ! command -v tar >/dev/null 2>&1; then
    echo "error: 'tar' is required to install grindxp." >&2
    exit 1
  fi

  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

  if [[ ! -f "${TMP_DIR}/${BINARY_NAME}" ]]; then
    echo "error: downloaded archive is missing ${BINARY_NAME}" >&2
    exit 1
  fi

  if [[ ! -f "${TMP_DIR}/drizzle/meta/_journal.json" ]]; then
    echo "error: downloaded archive is missing bundled migrations" >&2
    exit 1
  fi

  cp "${TMP_DIR}/${BINARY_NAME}" "$DEST"
  chmod +x "$DEST"

  rm -rf "$DRIZZLE_DEST"
  cp -R "${TMP_DIR}/drizzle" "$DRIZZLE_DEST"
else
  echo "Archive bundle not available for v${GRIND_VERSION}; falling back to legacy binary format..."
  curl -fsSL --progress-bar "$LEGACY_DOWNLOAD_URL" -o "$DEST"
  chmod +x "$DEST"
fi

trap - EXIT
cleanup

if [[ -e "$ALIAS_DEST" || -L "$ALIAS_DEST" ]]; then
  rm -f "$ALIAS_DEST"
fi
ln -s "$DEST" "$ALIAS_DEST"

# ── PATH setup ────────────────────────────────────────────────────────────────

add_to_path() {
  local rc_file="$1"
  local line="$2"

  if [[ ! -f "$rc_file" ]]; then
    touch "$rc_file"
  fi

  if ! grep -qF "$line" "$rc_file" 2>/dev/null; then
    echo "" >> "$rc_file"
    echo "# Added by Grind installer" >> "$rc_file"
    echo "$line" >> "$rc_file"
    echo "  Added to $rc_file"
  fi
}

build_path_line() {
  local dir="$GRIND_INSTALL_DIR"

  if [[ "$dir" == "$HOME" ]]; then
    dir='\$HOME'
  elif [[ "$dir" == "$HOME/"* ]]; then
    dir="\$HOME/${dir#$HOME/}"
  fi

  printf 'export PATH="%s:$PATH"' "$dir"
}

PATH_LINE="$(build_path_line)"

if [[ ":$PATH:" != *":${GRIND_INSTALL_DIR}:"* ]]; then
  if [[ -n "${ZDOTDIR:-}" && "$ZDOTDIR" != "$HOME" ]]; then
    add_to_path "$ZDOTDIR/.zshrc" "$PATH_LINE"
  fi
  add_to_path "$HOME/.zshrc" "$PATH_LINE"
  add_to_path "$HOME/.bashrc" "$PATH_LINE"
  add_to_path "$HOME/.profile" "$PATH_LINE"
  export PATH="${GRIND_INSTALL_DIR}:$PATH"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "grindxp v${GRIND_VERSION} installed to ${DEST}"
echo "Added compatibility alias: ${ALIAS_DEST} -> ${DEST}"

if ! command -v "$PRIMARY_CMD" >/dev/null 2>&1; then
  echo ""
  echo "Note: '$PRIMARY_CMD' is not available in this shell yet."
  echo "Open a new terminal or run: source ~/.zshrc (or ~/.bashrc)"
fi

if [[ "$NO_INIT" -eq 1 ]]; then
  echo ""
  echo "Skipped setup wizard (--no-init). Run '$PRIMARY_CMD init' when you're ready."
  exit 0
fi

if [[ -t 0 && -t 1 && -r /dev/tty ]]; then
  echo ""
  echo "Starting setup wizard (pass --no-init to skip)..."
  if ! "$DEST" init </dev/tty; then
    echo ""
    echo "Setup wizard did not complete. Run '$PRIMARY_CMD init' to retry."
  fi
else
  echo ""
  echo "No interactive terminal detected. Run '$PRIMARY_CMD init' to set up your vault."
fi
