#!/bin/bash
# NeuroStore Node Installer for Linux
# This script installs the NeuroStore node as a systemd service.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================================${NC}"
echo -e "${BLUE}       NEUROSTORE NODE - LINUX INSTALLER               ${NC}"
echo -e "${BLUE}=========================================================${NC}"

# Check for root privileges
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root (sudo)${NC}" 
   exit 1
fi

# Configuration
INSTALL_DIR="/opt/neurostore"
BINARY_NAME="neuro-node"
CONFIG_DIR="/etc/neurostore"
DATA_DIR="/var/lib/neurostore"
USER_NAME="neurostore"

# Create user and group if they don't exist
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    echo -e "${BLUE}Creating system user '$USER_NAME'...${NC}"
    useradd -r -s /bin/false "$USER_NAME"
fi

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"

# Download or copy binary
# In a real production environment, we would download from a release URL.
# For now, we assume the binary is in the same directory as the script.
if [ -f "./$BINARY_NAME" ]; then
    echo -e "${BLUE}Installing $BINARY_NAME binary...${NC}"
    cp "./$BINARY_NAME" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/$BINARY_NAME"
else
    echo -e "${RED}Error: $BINARY_NAME binary not found in current directory.${NC}"
    echo -e "Please ensure you have compiled the node or downloaded the release."
    exit 1
fi

# Setup basic config if not exists
CONFIG_PATH="$CONFIG_DIR/node-config.json"
if [ ! -f "$CONFIG_PATH" ]; then
    echo -e "${BLUE}Initializing default configuration...${NC}"
    cat <<EOF > "$CONFIG_PATH"
{
  "storage_path": "$DATA_DIR",
  "max_gb": 50,
  "gateway_url": "https://neurostore-backend-production.up.railway.app",
  "auto_register": true
}
EOF
fi

# Set permissions
chown -R "$USER_NAME":"$USER_NAME" "$INSTALL_DIR"
chown -R "$USER_NAME":"$USER_NAME" "$CONFIG_DIR"
chown -R "$USER_NAME":"$USER_NAME" "$DATA_DIR"

# Create systemd service file
echo -e "${BLUE}Creating systemd service...${NC}"
cat <<EOF > /etc/systemd/system/neurostore-node.service
[Unit]
Description=NeuroStore Decentralized Storage Node
After=network.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BINARY_NAME --setup-config-path $CONFIG_PATH
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and start service
systemctl daemon-reload
systemctl enable neurostore-node
systemctl start neurostore-node

echo -e "${GREEN}=========================================================${NC}"
echo -e "${GREEN}   NEUROSTORE NODE INSTALLED SUCCESSFULLY!               ${NC}"
echo -e "${GREEN}=========================================================${NC}"
echo -e "Status: $(systemctl is-active neurostore-node)"
echo -e "Logs: journalctl -u neurostore-node -f"
echo -e "Config: $CONFIG_PATH"
echo -e "Storage: $DATA_DIR"
echo -e "${GREEN}=========================================================${NC}"
