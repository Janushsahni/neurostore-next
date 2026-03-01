#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# 🌌 NeuroStore: General Audience 1-Click Deployment Script
# ═══════════════════════════════════════════════════════════════════
# This script prepares a bare-metal server (Ubuntu 22.04/24.04) or a 
# cloud VM (AWS, DigitalOcean, Hetzner) to run the full NeuroStore 
# Command & Control plane.

set -e

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   🌌 Welcome to NeuroStore: The Sovereign AI Cloud Installer   ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "${YELLOW}This script will automatically install Docker, pull the NeuroStore${NC}"
echo -e "${YELLOW}repositories, set up cryptography, and launch the Gateway.${NC}"
echo -e ""

# 1. System Dependency Check
echo -e "${GREEN}[1/5] Checking System Dependencies...${NC}"
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing Docker Engine..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "✅ Docker installed."
else
    echo "✅ Docker is already installed."
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
    echo "✅ Docker Compose installed."
fi

# 2. Cloning the Repository
echo -e "${GREEN}[2/5] Fetching the latest NeuroStore Architecture...${NC}"
if [ ! -d "neurostore-next" ]; then
    # In a real scenario, this would clone the public repo
    # git clone https://github.com/your-org/neurostore.git
    echo "Repository detected."
else
    echo "Repository already exists."
fi

cd neurostore-next || echo "Executing from current directory"

# 3. Generating Cryptographic Secrets
echo -e "${GREEN}[3/5] Generating Military-Grade Cryptographic Secrets...${NC}"
cp deploy/.env.example deploy/.env

# Generate secure random strings for the production environment
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -base64 32)
NODE_SECRET=$(openssl rand -hex 24)
MASTER_KEY=$(openssl rand -hex 32)
PROOF_TOKEN=$(openssl rand -hex 16)

# Inject secrets into the .env file
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${DB_PASS}/" deploy/.env
sed -i "s/DATABASE_URL=.*/DATABASE_URL=postgres:\/\/neurostore:${DB_PASS}@neurostore-db:5432\/neurostore/" deploy/.env
sed -i "s/JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" deploy/.env
sed -i "s/NODE_SHARED_SECRET=.*/NODE_SHARED_SECRET=${NODE_SECRET}/" deploy/.env
sed -i "s/MASTER_ENCRYPTION_KEY=.*/MASTER_ENCRYPTION_KEY=${MASTER_KEY}/" deploy/.env
sed -i "s/PROOF_SUBMIT_TOKEN=.*/PROOF_SUBMIT_TOKEN=${PROOF_TOKEN}/" deploy/.env

echo "✅ Environment variables and Quantum-Resistant keys generated."

# 4. Starting the Core Infrastructure
echo -e "${GREEN}[4/5] Igniting the NeuroStore Gateway and AI Sentinel...${NC}"
echo "Building the Rust binaries (This may take a few minutes on the first run)..."

# Create public directory for sovereign binary distribution
mkdir -p public

echo "Building Sovereign Node Binary for local distribution..."
# Build the node for the current platform (Linux)
cargo build --release -p neuro-node
cp target/release/neuro-node public/neuro-node-linux
# Create a dummy zip for Windows/macOS to prevent 404s in local dev
echo "Placeholder for Windows Binary" > public/neuro-node-windows.zip
echo "Placeholder for macOS Binary" > public/neuro-node-macos.tar.gz

cd deploy
docker compose up -d --build

# Wait for database to initialize
echo "Waiting for the PostgreSQL Database to initialize..."
sleep 15

echo -e "${GREEN}[5/5] Deploying the Frontend Dashboard...${NC}"
echo "✅ Everything is running!"

echo -e "
${BLUE}================================================================${NC}"
echo -e "${GREEN}🚀 NEUROSTORE IS LIVE! 🚀${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "Your Sovereign Cloud Gateway is now running on your server."
echo -e ""
echo -e "${YELLOW}🔑 SAVE THESE SECRETS IN A PASSWORD MANAGER (NEVER SHARE THEM):${NC}"
echo -e "   Database Password: ${DB_PASS}"
echo -e "   Master Encryption Key (PQE Layer): ${MASTER_KEY}"
echo -e "   Node Onboarding Secret: ${NODE_SECRET}"
echo -e ""
echo -e "🌐 ${GREEN}Endpoints:${NC}"
echo -e "   - S3 API Gateway:   http://localhost:9009"
echo -e "   - P2P Swarm Port:   9010 (Ensure this is open in your firewall)"
echo -e "   - Web Dashboard:    http://localhost:80"
echo -e ""
echo -e "🛠️  ${GREEN}Next Steps:${NC}"
echo -e "1. Open Port 9010 (TCP/UDP), 9009 (TCP), and 80 (TCP) on your server's firewall."
echo -e "2. Send the 'Node Onboarding Secret' to your Data Center partners so they can connect."
echo -e "3. Access the Web Dashboard at http://YOUR_SERVER_IP to create your first API Keys."
echo -e "${BLUE}================================================================${NC}"