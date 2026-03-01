#!/bin/bash
# 🌌 NeuroStore India: One-Command Join Script
# Usage: curl -sSL join.neurostore.in | bash -s -- --wallet 0x123 --storage 500GB

set -e

echo "Starting NeuroStore Node Onboarding..."

# 1. Parse Arguments
WALLET_ADDRESS=""
STORAGE_SIZE="100GB"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --wallet) WALLET_ADDRESS="$2"; shift ;;
        --storage) STORAGE_SIZE="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$WALLET_ADDRESS" ]; then
    echo "ERROR: --wallet address is required to receive rewards."
    exit 1
fi

# 2. Check for Docker
if ! [ -x "$(command -v docker)" ]; then
  echo "Error: Docker is not installed. Please install Docker first."
  exit 1
fi

# 3. Generate Peer Identity (if not exists)
if [ ! -f ./neuro_identity.key ]; then
    echo "Generating unique cryptographic Peer ID..."
    docker run --rm -v $(pwd):/keys neurostore/node-agent:latest generate-identity
fi

PEER_ID=$(cat ./peer_id.txt || echo "node-$(date +%s)")

# 4. Start the Node
echo "Launching NeuroStore Node Agent [Peer: $PEER_ID]..."

docker run -d 
  --name neuro-node-active 
  --restart always 
  -p 9010:9010 
  -v $(pwd)/blobs:/var/lib/neurostore/blobs 
  -e WALLET_ADDRESS="$WALLET_ADDRESS" 
  -e STORAGE_GB="$STORAGE_SIZE" 
  -e GATEWAY_URL="https://gateway.neurostore.in" 
  neurostore/node-agent:latest

# 5. Register with AI Sentinel
echo "Registering with Indian AI Sentinel Mesh..."
curl -X POST https://gateway.neurostore.in/api/nodes/register 
  -H "Content-Type: application/json" 
  -d "{
    "peer_id": "$PEER_ID",
    "wallet_address": "$WALLET_ADDRESS",
    "capacity_gb": ${STORAGE_SIZE//[!0-9]/},
    "declared_location": "IN-AUTO"
  }"

echo "---------------------------------------------------"
echo "SUCCESS: Your node is now active and earning $NEURO."
echo "Dashboard: https://console.neurostore.in/provider/$PEER_ID"
echo "---------------------------------------------------"
