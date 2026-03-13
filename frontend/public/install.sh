#!/bin/bash
set -e

echo "========================================="
echo "   NeuroStore Node Terminal Setup"
echo "========================================="

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Linux" ]; then
    OS_TARGET="linux"
elif [ "$OS" = "Darwin" ]; then
    OS_TARGET="macos"
    if [ "$ARCH" = "x86_64" ]; then
        echo "Detected macOS x86_64"
    elif [ "$ARCH" = "arm64" ]; then
        echo "Detected macOS ARM64"
    else
        echo "Unsupported macOS architecture: $ARCH"
        exit 1
    fi
else
    echo "Unsupported OS: $OS"
    exit 1
fi

if [ "$ARCH" = "x86_64" ]; then
    ARCH_TARGET="x86_64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    if [ "$OS_TARGET" = "linux" ]; then
         echo "Unsupported Linux architecture (arm64 not ready yet)"
         exit 1
    fi
    ARCH_TARGET="arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

DOWNLOAD_URL="https://neurostore-backend-production.up.railway.app/api/downloads/node/${OS_TARGET}/${ARCH_TARGET}"
INSTALL_DIR="$HOME/.neurostore/bin"
EXECUTABLE="$INSTALL_DIR/neuro-node"

mkdir -p "$INSTALL_DIR"

echo "Downloading NeuroStore Node..."
curl -L --progress-bar "$DOWNLOAD_URL" -o "$EXECUTABLE"
chmod +x "$EXECUTABLE"

echo "Download complete."
echo "Running node setup..."
"$EXECUTABLE" --interactive-setup
